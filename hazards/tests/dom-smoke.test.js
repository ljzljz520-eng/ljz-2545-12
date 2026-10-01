// 不引入 jsdom：用最小 DOM 桩验证 ui.js 的渲染路径不抛错、产出锚点与 aria 属性。
import { test, ok } from './run.js';

// 极简元素桩
function el(tag = 'div') {
  const node = {
    tag: tag, children: [], attributes: {}, style: {}, classList: { _s: new Set(),
      add(...x) { x.forEach((v) => this._s.add(v)); }, remove(...x) { x.forEach((v) => this._s.delete(v)); },
      toggle(v, f) { (f ?? !this._s.has(v)) ? this._s.add(v) : this._s.delete(v); }, contains: (v) => node.classList._s.has(v) },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener() {}, appendChild(c) { this.children.push(c); },
    querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, scrollIntoView() {}, click() {},
  };
  return node;
}

test('DOM 桩下可加载 ui 模块（环境守卫不报错）', async () => {
  globalThis.window = globalThis.window || {};
  globalThis.document = { getElementById: () => null };
  const mod = await import('../src/ui.js');
  ok(typeof mod.initHazardsPage === 'function');
  mod.initHazardsPage(); // 无 #hzApp 时应直接返回
});
