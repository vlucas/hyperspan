import { test, expect, describe } from 'bun:test';
import { functionToString } from './js';

describe('functionToString', () => {
  describe('named functions', () => {
    test('converts named function to string', () => {
      function myFunction() {
        return 'hello';
      }

      const result = functionToString(myFunction);
      expect(result).toContain('function');
      expect(result).toContain('myFunction');
      expect(result).toContain("return 'hello'");
    });

    test('converts named function with parameters', () => {
      function add(a: number, b: number) {
        return a + b;
      }

      const result = functionToString(add);
      expect(result).toContain('function');
      expect(result).toContain('add');
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    test('converts named async function', () => {
      async function fetchData() {
        const response = await fetch('/api/data');
        return response.json();
      }

      const result = functionToString(fetchData);
      expect(result).toContain('async function');
      expect(result).toContain('fetchData');
      expect(result).toContain('await');
    });
  });

  describe('anonymous functions', () => {
    test('converts anonymous function to string', () => {
      const fn = function () {
        return 'anonymous';
      };

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain("return 'anonymous'");
    });

    test('converts anonymous function with parameters', () => {
      const fn = function (x: number, y: number) {
        return x * y;
      };

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain('x');
      expect(result).toContain('y');
    });

    test('converts anonymous async function', () => {
      const fn = async function () {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'done';
      };

      const result = functionToString(fn);
      expect(result).toContain('async function');
      expect(result).toContain('await');
    });
  });

  describe('arrow functions', () => {
    test('converts single-line arrow function without braces', () => {
      const fn = (x: number) => x * 2;

      const result = functionToString(fn);
      expect(result).toContain('function(x) { return x * 2; }');
    });

    test('converts single-line arrow function with single parameter', () => {
      const fn = (name: string) => `Hello, ${name}!`;

      const result = functionToString(fn);
      expect(result).toContain('function(name) { return `Hello, ${name}!`; }');
    });

    test('converts single-line arrow function with multiple parameters', () => {
      const fn = (a: number, b: number) => a + b;

      const result = functionToString(fn);
      expect(result).toContain('function(a, b) { return a + b; }');
    });

    test('converts arrow function with braces', () => {
      const fn = (x: number) => {
        const doubled = x * 2;
        return doubled;
      };

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain('x');
      expect(result).toContain('doubled');
    });

    test('converts multi-line arrow function', () => {
      const fn = (items: string[]) => {
        const filtered = items.filter(item => item.length > 0);
        return filtered.map(item => item.toUpperCase());
      };

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain('items');
      expect(result).toContain('filtered');
    });

    test('converts async arrow function without braces', () => {
      const fn = async (id: number) => await fetch(`/api/${id}`);

      const result = functionToString(fn);
      expect(result).toContain('async function');
      expect(result).toContain('id');
      expect(result).toContain('await');
    });

    test('converts async arrow function with braces', () => {
      const fn = async (id: number) => {
        const response = await fetch(`/api/${id}`);
        return response.json();
      };

      const result = functionToString(fn);
      expect(result).toContain('async function');
      expect(result).toContain('id');
      expect(result).toContain('await');
    });

    test('converts arrow function with no parameters', () => {
      const fn = () => 'no params';

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain("return 'no params'");
    });

    test('converts arrow function with complex expression', () => {
      const fn = (obj: { x: number; y: number }) => obj.x + obj.y;

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain('return');
      expect(result).toContain('obj.x + obj.y');
    });
  });

  describe('edge cases', () => {
    test('handles function with whitespace', () => {
      const fn = function () {
        return 'test';
      };

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain("return 'test'");
    });

    test('handles arrow function with whitespace', () => {
      const fn = (x) => x * 2;

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain('return');
    });

    test('handles function with comments', () => {
      const fn = function () {
        // This is a comment
        return 'commented';
      };

      const result = functionToString(fn);
      expect(result).toContain('function');
      expect(result).toContain("return 'commented'");
    });

    test('handles nested arrow functions', () => {
      const fn = (arr: number[]) => arr.map(x => x * 2);

      const result = functionToString(fn);
      expect(result).toContain('function');
      // The nested arrow function should also be converted
      expect(result).toContain('x * 2');
    });
  });
});
