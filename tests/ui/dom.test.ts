// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { el, THEME_CSS_PATH } from '../../src/ui/dom';

describe('el()', () => {
  it('creates an element of the requested tag with no attrs or children', () => {
    const div = el('div');
    expect(div.tagName).toBe('DIV');
    expect(div.attributes.length).toBe(0);
    expect(div.childNodes.length).toBe(0);
  });

  it('sets every attribute via setAttribute', () => {
    const input = el('input', { type: 'number', min: '0', max: '10', value: '5' });
    expect(input.getAttribute('type')).toBe('number');
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('max')).toBe('10');
    expect(input.getAttribute('value')).toBe('5');
  });

  it('mirrors the class attribute onto className', () => {
    const div = el('div', { class: 'panel dock' });
    expect(div.getAttribute('class')).toBe('panel dock');
    expect(div.className).toBe('panel dock');
  });

  it('appends string children as text nodes', () => {
    const p = el('p', {}, 'hello', ' ', 'world');
    expect(p.textContent).toBe('hello world');
    expect(p.childNodes.length).toBe(3);
    expect(p.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('appends Node children directly, preserving order with mixed string children', () => {
    const span = el('span', {}, 'x');
    const p = el('p', {}, 'a', span, 'b');
    expect(p.childNodes.length).toBe(3);
    expect(p.childNodes[1]).toBe(span);
    expect(p.textContent).toBe('axb');
  });

  it('builds nested structures usable as real DOM', () => {
    const list = el('ul', { class: 'items' }, el('li', {}, 'one'), el('li', {}, 'two'));
    document.body.appendChild(list);
    expect(document.querySelectorAll('.items li').length).toBe(2);
    expect(document.querySelectorAll('.items li')[0]?.textContent).toBe('one');
    document.body.removeChild(list);
  });

  it('works with no attrs object at all (children-only call)', () => {
    const div = el('div', undefined, 'just text');
    expect(div.textContent).toBe('just text');
  });
});

describe('THEME_CSS_PATH', () => {
  it('points at the theme stylesheet under src/ui', () => {
    expect(THEME_CSS_PATH).toBe('/src/ui/theme.css');
  });
});
