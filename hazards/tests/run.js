// 零依赖测试运行器：node hazards/tests/run.js
let passed = 0;
let failed = 0;
const failures = [];

export function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.error(`✗ ${name}\n    ${err.message}`);
  }
}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} 期望 ${e}，实际 ${a}`);
}

export function ok(cond, msg = '') {
  if (!cond) throw new Error(msg || '期望为真');
}

export function approx(actual, expected, eps = 0.5, msg = '') {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${msg} 期望≈${expected}（±${eps}），实际 ${actual}`);
  }
}

export async function finish() {
  await Promise.resolve();
  console.log(`\n${failed === 0 ? '✅' : '❌'} 通过 ${passed} / ${passed + failed}`);
  if (failed) {
    console.error(`\n失败明细：\n${failures.map((f) => `- ${f.name}: ${f.err.stack || f.err.message}`).join('\n')}`);
    process.exit(1);
  }
}
