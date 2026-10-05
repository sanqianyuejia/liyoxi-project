#!/usr/bin/env python3
"""校验数据模型：分组文档的字段表 ↔ 跑完全部迁移的库。

表结构已由 packages/db 的迁移接管（W0-05），草稿 docs/data-model/schema.prisma 与 constraints/ 冻结（W0-06b）。
本工具从“校验草稿”改成“校验分组文档有没有跟上迁移”。

缺省流程：
1. 建一个临时库，按目录名顺序执行 packages/db/prisma/migrations/ 下的全部迁移（psql，一个迁移一个事务）；
2. 逐列比对 docs/data-model/ 下各分组文档里的字段表与库里的实际结构（列名、类型、可空）；
3. 扫描文档里“表.列”形式的引用，列出库里不存在的列（只提示，不计入结论）。

--existing <库>：不建库，拿一个已经跑完迁移的库来比，只读（CI 里比的是 lyx_migrate_check）。
--from-draft：旧流程，由冻结的草稿建库（Prisma 7.9.1 校验 schema.prisma → 离线生成建表语句 → 执行 →
              按文件名顺序执行 constraints/*.sql），再做上面的第 2、3 步。要先在本目录 npm install。
--docs <目录>：分组文档换一个目录读（门禁自测拿改过的副本来试）。

前提：本机可用 psql，并能以有建库权限的用户连上 PostgreSQL 17。
连接参数用标准的 PG 环境变量（PGHOST、PGPORT、PGUSER、PGPASSWORD）。
临时库名默认 lyx_schema_check，**会先删除再新建**，所以库名必须以 lyx_ 开头；--existing 不建不删，不限库名。

用法：python3 tools/schema-check/check.py [--db 库名] [--keep] [--from-draft] [--existing 库名] [--docs 目录]
退出码：0 通过；2 文档与库有差异；1 没比成（连不上、建库或迁移失败）。
"""
import argparse, glob, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DM = os.path.join(ROOT, 'docs', 'data-model')
MIGRATIONS = os.path.join(ROOT, 'packages', 'db', 'prisma', 'migrations')
ap = argparse.ArgumentParser(description='校验数据模型：分组文档的字段表与跑完全部迁移的库逐列比对')
ap.add_argument('--db', default='lyx_schema_check',
                help='临时库名（不是“要检查的库”）：会被删除后重建，必须以 lyx_ 开头；默认 lyx_schema_check')
ap.add_argument('--keep', action='store_true', help='保留临时库，便于手工查看（tools/api-check 也用它）')
ap.add_argument('--from-draft', action='store_true',
                help='旧流程：由冻结的草稿 docs/data-model/schema.prisma 与 constraints/ 建库，不跑迁移')
ap.add_argument('--existing', metavar='库名',
                help='不建库：拿这个已经跑完迁移的库来比，只读；与 --db、--keep、--from-draft 不能同用')
ap.add_argument('--docs', default=DM, metavar='目录', help='分组文档所在的目录；默认 docs/data-model')
args = ap.parse_args()
if args.existing and (args.keep or args.from_draft or args.db != 'lyx_schema_check'):
    sys.exit('--existing 是只读地比一个已有的库：不能与 --db、--keep、--from-draft 同用')
if not re.fullmatch(r'lyx_[a-z0-9_]{1,58}', args.db):
    sys.exit('--db 是临时库名，会被删除后重建：只接受以 lyx_ 开头、由小写字母、数字、下划线组成的名字')
if args.from_draft and not os.path.isdir(os.path.join(HERE, 'node_modules', 'prisma')):
    sys.exit('没有找到 Prisma：先执行 cd tools/schema-check && npm install')
if not os.path.isdir(args.docs):
    sys.exit(f'--docs 给的目录不存在：{args.docs}')

def say(s=''): print(s)
def psql(db, *a):
    # -X 不读 ~/.psqlrc；-w 不交互式要密码（缺密码时直接失败）
    return subprocess.run(['psql', '-X', '-w', '-d', db, *a], capture_output=True, text=True)
def run_file(db, path, single_transaction=False):
    # 出错即停，按退出码判断成败：不依赖服务端报错信息的语言
    flags = ['-q', '-v', 'ON_ERROR_STOP=1'] + (['-1'] if single_transaction else [])
    r = psql(db, *flags, '-f', path)
    return r.returncode, [l for l in r.stderr.split('\n') if l.strip()]

work = tempfile.mkdtemp(prefix='lyx-schema-')
created = False

def create_db():
    global created
    say(f'临时库：{args.db}（PGHOST={os.environ.get("PGHOST", "本机默认")}，PGPORT={os.environ.get("PGPORT", "默认")}），删除后重建')
    psql('postgres', '-qc', f'DROP DATABASE IF EXISTS {args.db}')
    r = psql('postgres', '-qc', f'CREATE DATABASE {args.db}')
    if r.returncode != 0:
        say('无法建库（检查 PG 连接参数与权限）：\n' + r.stderr); return False
    created = True
    return True

def build_from_migrations():
    """缺省流程：空库上按目录名顺序跑完全部迁移。返回出问题的个数；建不成返回 None"""
    files = sorted(glob.glob(os.path.join(MIGRATIONS, '*', 'migration.sql')))
    if not files:
        say('没有找到迁移：packages/db/prisma/migrations/*/migration.sql'); return None
    if not create_db(): return None
    for f in files:
        name = os.path.basename(os.path.dirname(f))
        # 一个迁移一个事务，与 migrate deploy 的效果相同；带 CONCURRENTLY 的不能放进事务，原样执行
        concurrently = re.search(r'\bconcurrently\b', open(f, encoding='utf8').read(), flags=re.I)
        rc, err = run_file(args.db, f, single_transaction=not concurrently)
        say(f'  迁移 {name}：' + ('成功' if rc == 0 else '执行失败（在第一处错误停下）'))
        if rc != 0:
            for l in err[:10]: say('    ' + l)
            return None
    return 0

def build_from_draft():
    """旧流程：由冻结的草稿建库。返回出问题的个数；建不成返回 None"""
    problems = 0
    shutil.copy(os.path.join(DM, 'schema.prisma'), os.path.join(work, 'schema.prisma'))
    with open(os.path.join(work, 'prisma.config.ts'), 'w', encoding='utf8') as fh:
        fh.write("import { defineConfig } from 'prisma/config'\n"
                 "export default defineConfig({ schema: './schema.prisma', datasource: { url: 'postgresql://localhost/unused' } })\n")
    os.symlink(os.path.join(HERE, 'node_modules'), os.path.join(work, 'node_modules'))
    def prisma(*a):
        return subprocess.run(['npx', '--no-install', 'prisma', *a], cwd=work, capture_output=True, text=True)
    r = prisma('format', '--check')
    if r.returncode != 0:
        say('提示：schema.prisma 不是 prisma format 的标准格式（不影响校验）')
    r = prisma('validate')
    if r.returncode != 0:
        say('Prisma validate 失败：\n' + r.stdout + r.stderr); return None
    say('Prisma validate：通过')
    r = prisma('migrate', 'diff', '--from-empty', '--to-schema', 'schema.prisma', '--script')
    if r.returncode != 0:
        say('生成建表语句失败：\n' + r.stdout + r.stderr); return None
    ddl = r.stdout[r.stdout.find('--'):].split('┌')[0]
    with open(os.path.join(work, 'schema.sql'), 'w', encoding='utf8') as fh: fh.write(ddl)
    n_tables = len(re.findall(r'^CREATE TABLE', ddl, flags=re.M))
    say(f'建表语句：{n_tables} 张表')
    if n_tables == 0:
        say('没有生成任何建表语句'); return None
    if not create_db(): return None
    rc, err = run_file(args.db, os.path.join(work, 'schema.sql'))
    if rc != 0:
        say('执行建表语句失败：\n' + '\n'.join(err[:20])); return None
    say('执行建表语句：成功')
    files = sorted(glob.glob(os.path.join(DM, 'constraints', '*.sql')))
    if not files:
        say('没有找到 constraints/*.sql'); return None
    for f in files:
        rc, err = run_file(args.db, f)
        n = len(re.findall(r';\s*$', open(f, encoding='utf8').read(), flags=re.M))
        say(f'  {os.path.basename(f)}：约 {n} 条' + ('，全部成功' if rc == 0 else '，执行失败（在第一处错误停下）'))
        if rc != 0:
            for l in err[:10]: say('    ' + l)
            problems += 1
    return problems

def compare(db):
    """分组文档的字段表 ↔ 库结构。返回出问题的个数；读不到库结构返回 None"""
    problems = 0
    q = psql(db, '-AtF', '\t', '-c',
             "select table_name, column_name, data_type, udt_name, is_nullable from information_schema.columns where table_schema='public'")
    cols = {}
    for line in q.stdout.strip().split('\n'):
        if line.count('\t') != 4: continue
        t, c, dt, udt, nul = line.split('\t'); cols.setdefault(t, {})[c] = (dt, udt, nul)
    if q.returncode != 0 or not cols:
        say(f'读不到库 {db} 的结构（库不存在、连不上，或还没跑迁移）：\n' + q.stderr); return None
    # 文档类型 → (data_type, udt_name；None 表示不比)
    TYPES = {'uuid': ('uuid', None), 'text': ('text', None), 'integer': ('integer', None), 'bigint': ('bigint', None),
             'boolean': ('boolean', None), 'timestamptz': ('timestamp with time zone', None), 'date': ('date', None),
             'jsonb': ('jsonb', None), 'smallint': ('smallint', None), 'bytea': ('bytea', None), 'numeric': ('numeric', None),
             'uuid[]': ('ARRAY', '_uuid'), 'text[]': ('ARRAY', '_text'), 'integer[]': ('ARRAY', '_int4')}
    docs = sorted(glob.glob(os.path.join(args.docs, '[0-9][0-9]-*.md')))
    diffs = 0; seen = set(); unknown_types = {}; unknown_null = 0
    for f in docs:
        for sec in re.split(r'^###\s+', open(f, encoding='utf8').read(), flags=re.M)[1:]:
            m = re.match(r'[\d.]*\s*`([a-z_0-9]+)`', sec)
            if not m: continue
            t = m.group(1); rows = []; intab = False
            for line in sec.split('\n'):
                if re.match(r'^\|\s*列\s*\|', line): intab = True; continue
                if intab:
                    if not line.startswith('|'):
                        if rows: break
                        continue
                    cells = [c.strip() for c in line.strip().strip('|').split('|')]
                    if set(cells[0]) <= set('-: '): continue
                    rows.append(cells)
            if not rows: continue
            seen.add(t)
            if t not in cols:
                say(f'  {os.path.basename(f)}：文档有表 {t}，库里没有'); diffs += 1; continue
            doc = {c[0].replace('`', '').strip(): (c[1].replace('`', '').strip().lower(), c[2]) for c in rows}
            for c in sorted(set(doc) ^ set(cols[t])):
                say(f'  {t}.{c}：' + ('文档有、库里没有' if c in doc else '库里有、文档没有')); diffs += 1
            for c in sorted(set(doc) & set(cols[t])):
                typ, nul = doc[c]; dt, udt, isnul = cols[t][c]
                key = re.sub(r'\(.*\)', '', typ).strip()
                exp = TYPES.get(key)
                if exp is None:
                    unknown_types[key] = unknown_types.get(key, 0) + 1
                elif exp[0] != dt or (exp[1] and exp[1] != udt):
                    say(f'  {t}.{c}：文档 {typ}，库里 {dt}（{udt}）'); diffs += 1
                want = 'NO' if ('否' in nul or '不可' in nul) else 'YES' if '可' in nul else None
                if want is None: unknown_null += 1
                elif want != isnul: say(f'  {t}.{c}：文档可空“{nul}”，库里 {isnul}'); diffs += 1
    # 分区子表（名字随月份变）与 Prisma 自己的迁移记录表没有字段表
    missing = sorted(t for t in cols if t not in seen and t != '_prisma_migrations'
                     and not re.match(r'.*_(default|y\d{4}m\d{2})$', t))
    say(f'文档与库结构：{len(docs)} 份分组文档，解析到 {len(seen)} 张表的字段表，差异 {diffs} 处'
        + (f'；库里有而文档没有字段表的：{missing}' if missing else ''))
    if unknown_types or unknown_null:
        say(f'  未比对：类型写法不认识的 {sum(unknown_types.values())} 列（{", ".join(sorted(unknown_types))}），可空写法不认识的 {unknown_null} 列')
        problems += sum(unknown_types.values()) + unknown_null
    if not seen:
        say('没有从文档里解析到任何字段表'); problems += 1
    problems += diffs + len(missing)

    # 文档里引用的“表.列”（只提示，不计入结论：多数是 JSON 键、事件名、迁移名）
    stale = 0
    for f in docs:
        for i, line in enumerate(open(f, encoding='utf8'), 1):
            for t, c in re.findall(r'`([a-z][a-z0-9_]+)\.([a-z][a-z0-9_]+)`', line):
                if t in cols and c not in cols[t]:
                    stale += 1
                    if stale <= 40: say(f'  {os.path.basename(f)}:{i}：`{t}.{c}` 库里没有这一列')
    say(f'文档里用反引号写的“表.列”引用：{stale} 处找不到对应的列（可能是 JSON 键或事件名，需人工判断；不计入结论）')
    return problems

def main():
    if args.existing:
        say(f'比的是已有的库 {args.existing}（只读，不建不删）')
        built, db = 0, args.existing
    else:
        say('建库：' + ('由冻结的草稿（--from-draft，旧流程）' if args.from_draft else '空库上跑全部迁移'))
        built, db = (build_from_draft() if args.from_draft else build_from_migrations()), args.db
    if built is None: return 1
    compared = compare(db)
    if compared is None: return 1
    problems = built + compared
    say('\n结论：' + ('通过' if problems == 0 else f'有 {problems} 处问题'))
    return 0 if problems == 0 else 2

code = 1
try:
    code = main()
finally:
    # 失败时不留半成品库（否则 tools/api-check 会拿它去比）；成功且 --keep 才保留
    if created and not (args.keep and code == 0):
        psql('postgres', '-qc', f'DROP DATABASE IF EXISTS {args.db}')
    shutil.rmtree(work, ignore_errors=True)
sys.exit(code)
