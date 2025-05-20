import z from 'zod/v4';
import { createAction } from './actions';
import { describe, it, expect } from 'bun:test';
import { html, render, type HSHtml } from '@hyperspan/html';
import type { Context } from 'hono';

describe('createAction', () => {
  const formWithNameOnly = ({ data }: { data?: { name: string } }) => {
    return html`
      <form>
        <p>
          Name:
          <input type="text" name="name" value="${data?.name || ''}" />
        </p>
        <button type="submit">Submit</button>
      </form>
    `;
  };

  describe('with form content', () => {
    it('should create an action with a form that renders provided data', async () => {
      const schema = z.object({
        name: z.string(),
      });
      const action = createAction(schema, formWithNameOnly);

      const formResponse = render(action.render({ data: { name: 'John' } }) as HSHtml);
      expect(formResponse).toContain('value="John"');
    });
  });

  describe('when data is valid', () => {
    it('should run the handler and return the result', async () => {
      const schema = z.object({
        name: z.string().nonempty(),
      });
      const action = createAction(schema, formWithNameOnly)
        .post((c, { data }) => {
          return html`<div>Thanks for submitting the form, ${data?.name}!</div>`;
        })
        .error((c, { error }) => {
          return html`<div>There was an error! ${error?.message}</div>`;
        });

      // Mock context to run action
      const mockContext = {
        req: {
          formData: async () => {
            const formData = new FormData();
            formData.append('name', 'John');
            return formData;
          },
        },
      } as Context;

      const response = await action.run('POST', mockContext);

      const formResponse = render(response as HSHtml);
      expect(formResponse).toContain('Thanks for submitting the form, John!');
    });
  });

  describe('when data is invalid', () => {
    it('should return the content of the form with error', async () => {
      const schema = z.object({
        name: z.string().nonempty(),
      });
      const action = createAction(schema)
        .form(formWithNameOnly)
        .post((c, { data }) => {
          return html`<div>Thanks for submitting the form, ${data?.name}!</div>`;
        })
        .error((c, { error }) => {
          return html`<div>There was an error! ${error?.message}</div>`;
        });

      // Mock context to run action
      const mockContext = {
        req: {
          formData: async () => {
            const formData = new FormData();
            formData.append('name', ''); // No name = error
            return formData;
          },
        },
      } as Context;

      const response = await action.run('POST', mockContext);

      const formResponse = render(response as HSHtml);
      expect(formResponse).toContain('There was an error!');
    });
  });
});
