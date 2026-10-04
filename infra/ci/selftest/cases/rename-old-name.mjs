// W0-01 的门禁：换名检查。旧名在这里拼出来，免得本文件自己被判中。
const OLD = ["li", "yo"].join("");

export default {
  gate: "换名检查",
  mutation: "文件里出现参考工程的旧包作用域",
  reason: /换名检查未通过[\s\S]*packages\/x\/package\.json:2:/,
  run(ctx) {
    const dir = ctx.gitRepo({
      "packages/x/package.json": `{\n  "name": "@${OLD}/x"\n}\n`,
    });
    return ctx.node("infra/ci/check-rename.mjs", [], { cwd: dir });
  },
};
