import { $ } from "bun";
import { createInterface } from "node:readline/promises";

let msg = process.argv.slice(2).join(" ").trim();

if (!msg) {
    if (!process.stdin.isTTY) {
        console.error("用法: bun run git <提交信息>");
        process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("请输入提交信息: ")).trim();
    rl.close();
    if (!answer) {
        console.error("提交信息不能为空");
        process.exit(1);
    }
    msg = answer;
}

const status = await $`git status --porcelain`.text();
if (!status.trim()) {
    console.log("没有需要提交的改动");
    process.exit(0);
}

await $`git add -A`;
await $`git commit -m ${msg}`;
await $`git push`;