# B1–B6 任务定义（机器可读 + 验收脚本钩子）
# 每次 run 使用相同任务文本与验收标准。

TASKS = {
  "B1": {
    "name": "simple-edit-verify",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b{rep}",
    "prompt": "工作目录：{workdir}\n\n把 config.js 中的 RETRY_LIMIT 从 3 改成 5，然后运行 `node -e \"require('./config.js')\"` 确认没有语法错误。\n\n成功标准：\n1. config.js 内容变为 `const RETRY_LIMIT = 5;`\n2. node 命令执行成功（退出码 0）\n3. 模型调用次数 ≤ 4",
    "verify": "b1",
    "max_model_calls": 4,
  },
  "B2": {
    "name": "multi-step-count-report",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b2",
    "prompt": "工作目录：D:\\EchoCore\\echo-core\\bench\\repo-b2\\\n\n统计这 5 个 JSON 文件（log1.json 到 log5.json）中每个文件的记录数，然后在 report.md 中生成一个 Markdown 表格，列出文件名和记录数，最后加一行总记录数。\n\n成功标准：\n1. report.md 存在\n2. 包含 5 行文件数据（文件名 + 记录数）\n3. 记录数正确（log1=3, log2=4, log3=2, log4=5, log5=3）\n4. 包含总记录数行（17）\n5. 模型调用次数 ≤ 10",
    "verify": "b2",
    "max_model_calls": 10,
  },
  "B3": {
    "name": "multi-file-api-add",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b3",
    "prompt": "工作目录：D:\\EchoCore\\echo-core\\bench\\repo-b3\\\n\n在 utils/math.js 中新增一个 `multiply(a, b)` 函数（返回 a * b），在 utils/math.test.js 中为它添加测试断言，在 index.js 中导出并在底部打印 `6 * 7` 的结果，在 README.md 的 API 表格中添加 multiply 一行。\n\n成功标准：\n1. 4 个文件全部被修改\n2. `node utils/math.test.js` 输出 \"All tests passed\" 且退出码 0\n3. `node index.js` 打印 `6 * 7 = 42`\n4. README.md 表格包含 multiply 行\n5. 模型调用次数 ≤ 15",
    "verify": "b3",
    "max_model_calls": 15,
  },
  "B4": {
    "name": "tool-dense-todo-scan",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b4",
    "prompt": "工作目录：D:\\EchoCore\\echo-core\\bench\\repo-b4\\\n\n这个目录有 30 个 JS 文件（module01.js 到 module30.js）。搜索所有包含 TODO 注释的文件，列出每个文件中 TODO 的完整内容和行号，汇总到 todos.md。\n\n成功标准：\n1. todos.md 存在\n2. 包含恰好 5 个文件（module03, module07, module12, module19, module25）\n3. 每个条目包含文件名、行号、完整 TODO 文本\n4. 无遗漏、无多余\n5. 模型调用次数 ≤ 25",
    "verify": "b4",
    "max_model_calls": 25,
  },
  "B5A": {
    "name": "recover-missing-script",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b1",
    "prompt": "工作目录：D:\\EchoCore\\echo-core\\bench\\repo-b1\\\n\n运行 `node nonexistent-script.js`，如果失败，找到 config.js 并报告它的内容。\n\n成功标准：\n1. 识别命令失败（不静默通过）\n2. 报告 config.js 的内容\n3. 不重复运行相同失败命令 ≥ 3 次",
    "verify": "b5a",
  },
  "B5B": {
    "name": "recover-missing-file-edit",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b1",
    "prompt": "工作目录：D:\\EchoCore\\echo-core\\bench\\repo-b1\\\n\n编辑文件 `missing-file.js`，把 `const X = 1;` 改成 `const X = 2;`。\n\n成功标准：\n1. 识别文件不存在\n2. 报告失败原因\n3. 不创建伪造的文件来\"成功\"",
    "verify": "b5b",
  },
  "B5C": {
    "name": "recover-missing-tool",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b1",
    "prompt": "工作目录：D:\\EchoCore\\echo-core\\bench\\repo-b1\\\n\n使用 `super-search` 工具查找 config.js 中的 RETRY_LIMIT。\n\n成功标准：\n1. 识别工具不存在\n2. 改用现有工具（如 grep/read）完成任务或明确报告无法完成",
    "verify": "b5c",
  },
  "B6R1": {
    "name": "exp-first-multiply",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b3",
    "prompt": "工作目录：D:\\EchoCore\\echo-core\\bench\\repo-b3\\\n\n在 utils/math.js 中新增 `multiply(a, b)`（返回 a * b），在 utils/math.test.js 中添加测试断言，在 index.js 中导出并打印 `6 * 7` 的结果，在 README.md API 表格添加 multiply 一行。\n\n成功标准同 B3。",
    "verify": "b3",
  },
  "B6R2": {
    "name": "exp-second-divide",
    "workdir": r"D:\EchoCore\echo-core\bench\repo-b3",
    "prompt": "工作目录：D:\\EchoCore\\echo-core\\bench\\repo-b3\\（已含 multiply）\n\n给 math 模块添加 `divide(a, b)` 函数及其测试，参照之前 multiply 的模式。同步更新 index.js 导出/打印与 README 表格。\n\n成功标准：\n1. 4 个文件与 multiply 模式一致地更新\n2. 测试通过\n3. index.js 打印 divide 结果\n4. README 含 divide 行",
    "verify": "b6r2",
  },
}
