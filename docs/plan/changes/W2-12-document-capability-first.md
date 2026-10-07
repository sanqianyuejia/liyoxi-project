# W2-12 先交有界正文技术能力

| 项 | 内容 |
| --- | --- |
| 改了什么 | W2-12 从单 PR 预拆为同编号实施 PR1 正文技术能力与精确依赖、actual 后 PR2 原乙类八接口/2 cron/2桩；同步任务书、状态、计划与分配表的本包行、任务 README 第7.1节。本次仅计划，不安装依赖、不交实现。 |
| 原因 | 现有 StorageProvider.readPrefix 只读至多4096字节，不能完整计算 PDF 字节哈希；实际缺 Word 展示版与 PDF 文本处理能力。把未配置端口或 mock 转换当完成不能满足 a09 正文接口，也不能保证两应用 bundle 中隔离任务入口存在。 |
| 影响的包 | PR1 为0 HTTP/0页/0 x01/0桩，actual main 后才能恢复 PR2；整包保持进行中，W2-16仍等整包。M2/M3/M4的25/19/20包数、全部接口/页/x01/桩归属及退出条件保持。 |
| 类别 | 拆并 |
| PR | #136（文档计划；实施 PR1、PR2另交） |

## 1. 实施顺序与实际状态

本次六份文档只确定边界。之前业务阶段源码已阶段冻结，八条后台 HTTP 尚未挂载、两个 cron 尚未装配、真实正文能力和整包验收未完成；本计划合入不表示实施 PR1 actual，更不表示八接口或桩已完成。

实施 PR1 只交有限对象读取、L0 纯技术转换、隔离执行与两应用的真实构建产物。其实际 main 合入后，PR2 再将该端口绑定到 docs 的八接口/版本用例与两个 cron，回补原两项桩。PR2继续乙类；正文转换的业务 `converted/pdf_only/unchanged`、warnings 与 HTTP 错误映射按正式 a09 计算，PR1不定义业务 HTTP schema 或事件。

源规范优先于旧任务书：正式 13-notify-docs 第2.11节明确 agreement_version 为 lock_rank=null 的技术簿记，不写状态历史。PR2用协议自然键串行、版本行 FOR UPDATE、lockVersion 与领域审计，不新增 flow 状态机、锁表或锁序。x01实际只有 site_notice.announced/withdrawn；修正旧任务书虚构的版本事件。M1当前版本实时解析、同意记录只增/真实时刻顺序、交易证据与prod拒占位保持。W2-24已批准的窄 recordTransactionConsents 交易生产者按实际 main 合流保留，不重复实现。

## 2. 精确依赖与成熟维护版

以下版本于2026-10-08按 npm 官方 registry 核对；生产运行时从两个应用的 node_modules 解析裸包，因此三份生产清单都直接声明。

| 官方包 | 精确版本 | 官方发行时间（UTC） | Node兼容与声明位置 |
| --- | --- | --- | --- |
| [mammoth](https://registry.npmjs.org/mammoth) | 1.13.0 | 2026-09-26T22:11:25.198Z | ≥12；services/API/worker 各 dependencies |
| [sanitize-html](https://registry.npmjs.org/sanitize-html) | 2.17.7 | 2026-08-13T15:45:38.054Z | ≥22.12；services/API/worker 各 dependencies |
| [pdfjs-dist](https://registry.npmjs.org/pdfjs-dist) | 6.3.289 | 2026-08-29T12:52:28.054Z | ≥22.13或≥24；services/API/worker 各 dependencies |
| [@napi-rs/canvas](https://registry.npmjs.org/@napi-rs/canvas) | 1.0.9 | 2026-09-09T10:50:10.984Z | ≥10；services/API/worker 各 dependencies |
| [@types/sanitize-html](https://registry.npmjs.org/@types%2Fsanitize-html) | 2.16.2 | 2026-09-28T23:36:43.291Z | 仅services devDependencies |

共4类生产库、12处生产声明，另1处dev声明；清单精确锁定、pnpm-lock同步。native optional及其他传递依赖的每个发行也必须满7日，原 minimumReleaseAge:10080/trustPolicy 与依赖门禁全部保留，不新增豁免、不升级无关库。

sanitize-html选成熟维护版2.17.7，不等待2.18。[上游安全公告 GHSA-vccv-cmxp-4j9h](https://github.com/apostrophecms/apostrophe/security/advisories/GHSA-vccv-cmxp-4j9h)明确受影响≤2.17.4、已修复≥2.17.5，2.17.7包含该修复。该公告的可利用配置要求额外允许form/object等标签及action/data等URI属性，本方案仅正文结构标签且全部属性禁用；仍保留恶意HTML真回归。不能宣称已完整审核2.18与2.17.7所有差异。

[Mammoth官方安全说明](https://github.com/mwilliamson/mammoth.js#security)指出它不负责清洗 HTML，且必须关闭外部文件访问。[PDF.js官方问题记录](https://github.com/mozilla/pdf.js/issues/21720)证明 Node 文本路径也可能在模块初始化依赖 DOMMatrix；显式声明 native canvas、真实 Node24/Linux运行验证，不删 optional 包后写假 polyfill。

## 3. 有界读取、技术端口与权限复验

只向现有 StorageProvider 增加以下窄原语，不增加 Provider 类别：

```ts
readObject(
  input: ObjectRef & {
    maxBytes: number;
    ifMatchEtag?: string;
    signal?: AbortSignal;
  },
): Promise<ProviderResult<Uint8Array>>;
```

maxBytes须有限正整数；领域上传上限另外校验。先 HEAD 确认对象大小和可信etag，再 GetObject IfMatch 保证读取同一对象；逐块累积计数、实际流大小再次校验，超限/取消/错误立即销毁或cancel流并清理连接。不能 unbounded transformToByteArray、不能将预签URL再fetch、不能自行签云请求。返回独立的有限字节；成功/失败采用既有 ProviderResult，日志不含正文或bucket/key配置值。

接口、PROVIDER_METHODS、unconfigured、storage fake、样例、MinIO、事务外guard与原有完整方法断言一起补齐。旧 readPrefix 的4096上限、语义和测试不动。MinIO用真实临时对象验证 HEAD、条件读取、etag变更、超限流取消；只清本测试对象，不reset共享桶。

纯技术转换位于已登记 L0 `packages/services/src/kernel/document-conversion/`，必要公开导出经过 kernel/index.ts 与 services/src/index.ts。计划接口为：

```ts
createDocumentConverter({ workerUrl: URL, concurrency: 1 }): DocumentConverter;
interface DocumentConverter {
  convert(input: {
    sourceBytes: Uint8Array | null;
    pdfBytes: Uint8Array | null;
    signal?: AbortSignal;
  }): Promise<DocumentConversionResult>;
  close(): Promise<void>;
}
// 成功值：sourceSha256/pdfSha256/contentHtml/htmlSha256各可空；
// similarityBp:number|null（0..10000）；缺可抽文本不会伪造相似度。
// 失败：固定技术reason与source/pdf角色，不回传正文、解析异常或文件路径。
```

技术端口不接受actor、文件ID、数据库或HTTP conversion state；文件字节及HTML哈希均由真实内容计算。明确无source时contentHtml/htmlSha256=null，无pdf时pdfSha256=null，不拿文件名/etag当哈希。技术固定失败覆盖 invalid_document、unsupported_document、too_large、cancelled、deadline_exceeded；业务PR2按a09已有文件/转换错误语义映射，不把技术reason注册成新HTTP错误。Word损坏/加密/不支持转换对应已有 AGREEMENT_CONTENT_CONVERT_FAILED；权限/分类/存储状态继续实际media与a09的原错误语义。

权限仅由PR2的docs纯fileport/真实media owned校验：事务外prepare取得可信id/etag/bucket/key，有限读取/转换；按排序file锁后再次确认id/etag/归属、stored、legal_doc、docx/pdf、platform/scope。准备不授予最终写权限，不直import docs→media，不扩同层白名单；不可枚举的不存在/外scope保留原400/404语义。签名另在事务外新签，响应no-store、真实expiresAt，URL不落库。

## 4. 文件与资源边界

沿用实际 shared.maxUploadBytes：legal_doc 的docx、pdf每个20MiB，合计40MiB。不收紧成10MiB，不改上传Provider或分类授权。读取/worker输入采用逐块限额与可转移ArrayBuffer，避免无谓复制；转移前确保独占Buffer，不能转移共享池底层内存或泄露其他字节。

DOCX ZIP：最多256条、总展开≤32MiB、单entry≤8MiB、压缩比≤100；先校验中央目录、成员路径/数量/大小，再对真实inflate逐块计数执行同样上限，不能只信声明值。拒加密、宏、路径穿越、重复条目、互相重叠与不支持的ZIP格式。普通合法DOCX的数据描述器可在中央目录、实际流结束、CRC/尺寸互相核实后支持，不能一概禁用常见格式；不可安全核实才固定受控拒绝。不新增未声明ZIP库或直接import Mammoth传递的JSZip；Node内置zlib做预检/真实展开验证，并只把经过限额验证的内容交Mammoth。

Mammoth externalFileAccess=false；本地/网络外部引用不能读取。HTML只留h1–h6、p、br、ol、ul、li、strong、b、em、i、table、thead、tbody、tr、td、th；全部属性空白名单，无a/img/iframe/style/script/event/URL。PDF只接真实Uint8Array，不给URL；关闭eval、字体/外部资源读取与画布渲染路径，PDF文本抽取最多100页、抽取文本总≤250k codepoints，HTML UTF-8≤1MiB。DOCX纯文本也限250k codepoints，避免相似度输入超限。

容量必须在对象读取前取得，排队不持有正文原始字节，不缓存无界待处理输入；每进程默认并发1、每个任务10s壁钟、JS heap128MiB/stack4MiB，abort/超时必须真正terminate并等待退出、清空排队及句柄，close拒新工作并回收所有在途资源。PDF加载/文档对象在所有结果上destroy。不把JS heap当作native/external内存限制；不在本计划或能力PR抬Compose内存/上传上限。只有实际320MiB容器验证后才另评估并发2。

实际 node Compose 中API/worker各320MiB、根只读、/tmp64MiB；local stack这两进程没有同样硬内存上限，不能拿宽松本地结果代替。真实server容器测试必须覆盖20+20MiB合法边界/RSS峰值/取消/超时/无遗留句柄/主进程继续服务。容器被OOM杀不算受控失败。单worker若仍不满足，停止“能力完成”宣称，给调度具体最小实现修正；不默许扩容或缩小上传范围。

## 5. 相似度、PDF-only与真实产物验收

Word与PDF纯文本先Unicode NFC、按codepoint去空白，再计算相邻字符bigram multiset Dice：`2*交集计数/(两侧bigram计数之和)`。用唯一shared.divRoundHalfUp的实际数组API（分子因数`[2, intersection, 10000]`、分母`[total]`）取整数万分比，避免浮点/二次舍入/O(n*m)算法。非空同文10000；单字符文本显式比较；任一侧无可抽文本为0，只有缺一份文件时结果null。低于9800由PR2返回真实text_mismatch警告，不阻断、不落库、不声称法律等价。

正式a09允许PDF-only草稿：真实PDF字节hash，HTML与HTML hash为null，不以抽文成功作为PDF-only保存前提。合法扫描PDF没有文字仍可保存PDF-only，similarityBp=null；Word+PDF缺可抽文本时为0并给text_mismatch，不能假绿或因扫描正文拒绝合法PDF-only。损坏/加密/不支持的Word受控固定转换失败；PDF解析异常必须区分合法无文本/不支持抽取与损坏，内部错误不泄露、不伪造10000，不私造新HTTP契约；按a09实际文件可用性与转换语义落地。草稿文件可缺，安排生效仍按双文件/摘要/法务与时刻守卫，技术成功不会自动勾选法务。

两应用都新增薄入口 `src/cli/document-converter.ts`，仅调用services技术执行公开口。API的现有server/check-env构建和worker现有index/redis-compat/seed/staff-bootstrap构建各追加entry `document-converter`，实际输出各自 `dist/document-converter.js`。API保持第三方external+声明核验；worker将四库标external并补产物依赖核验。父应用主entry创建实际产物URL并传给组合根/技术端口；不能由bundle进chunk的域源码用new URL('./worker.js',import.meta.url)引用不存在文件。源码测试显式提供实际构建URL，不依赖缺失的src .js或生产tsx回退。

现有 `infra/docker/server/Dockerfile` 已复制两个应用的完整dist与生产node_modules；真实Linux镜像验证四库及native optional能从apps节点解析，两个converter产物都执行中文虚构文件。不能只测worker源文件、字符串是否含URL或mock processor。具体路径和命令见任务书第4.1/7.1节；新增测试/容器验收入口是计划，尚不存在、尚未运行。

真实虚构DOCX/PDF夹具覆盖标题/段落/表格/列表/中文/数字、白名单剥离、同文/异文与扫描PDF、20MiB边界、普通数据描述器及声明虚报/真实炸弹/宏/加密/路径/重复/不支持格式；真实两个Node24产物与Linux容器覆盖取消/10s/终止清理/主进程恢复。完整CI、独审和actual main才满足PR1完成条件。E8真实正文与法务审定始终外部待办；不提交真实文件、读取密钥、连接真实云或修改任何守卫/基线。
