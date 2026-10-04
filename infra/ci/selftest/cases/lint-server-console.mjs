// W0-01 的门禁：lint 禁用项（服务端禁 console.log）。
export default {
  gate: "lint：服务端禁 console.log",
  mutation: "apps/api 的路由里写 console.log",
  reason: "no-console",
  run(ctx) {
    return ctx.node(
      "node_modules/eslint/bin/eslint.js",
      ["--stdin", "--stdin-filename", "apps/api/src/routes/ping.ts"],
      { input: 'export function ping(): string {\n  console.log("pong");\n  return "pong";\n}\n' },
    );
  },
};
