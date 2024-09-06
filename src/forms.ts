import { Idiomorph } from './clientjs/idomorph.esm';

/**
 * Return JSON data structure for a given FormData object
 * Accounts for array fields (e.g. name="options[]" or <select multiple>)
 *
 * @link https://stackoverflow.com/a/75406413
 */
export function formDataToJSON(formData: FormData): Record<string, string | string[]> {
  let object = {};

  /**
   * Parses FormData key xxx`[x][x][x]` fields into array
   */
  const parseKey = (key: string) => {
    const subKeyIdx = key.indexOf('[');

    if (subKeyIdx !== -1) {
      const keys = [key.substring(0, subKeyIdx)];
      key = key.substring(subKeyIdx);

      for (const match of key.matchAll(/\[(?<key>.*?)]/gm)) {
        if (match.groups) {
          keys.push(match.groups.key);
        }
      }
      return keys;
    } else {
      return [key];
    }
  };

  /**
   * Recursively iterates over keys and assigns key/values to object
   */
  const assign = (keys: string[], value: FormDataEntryValue, object: any): void => {
    const key = keys.shift();

    // When last key in the iterations
    if (key === '' || key === undefined) {
      return object.push(value);
    }

    if (Reflect.has(object, key)) {
      // If key has been found, but final pass - convert the value to array
      if (keys.length === 0) {
        if (!Array.isArray(object[key])) {
          object[key] = [object[key], value];
          return;
        }
      }
      // Recurse again with found object
      return assign(keys, value, object[key]);
    }

    // Create empty object for key, if next key is '' do array instead, otherwise set value
    if (keys.length >= 1) {
      object[key] = keys[0] === '' ? [] : {};
      return assign(keys, value, object[key]);
    } else {
      object[key] = value;
    }
  };

  for (const pair of formData.entries()) {
    assign(parseKey(pair[0]), pair[1], object);
  }

  return object;
}

/**
 * Submit form data to route and replace contents with response
 */
export function formSubmitToRoute(e: Event, form: HTMLFormElement) {
  e.preventDefault();

  const formUrl = form.getAttribute('action') || '';
  const formData = new FormData(form);
  const method = form.getAttribute('method')?.toUpperCase() || 'POST';

  let response: Response;

  fetch(formUrl, { body: formData, method })
    .then((res: Response) => {
      const isRedirect = [301, 302].includes(res.status);

      // Is response a redirect? If so, let's follow it in the client!
      if (isRedirect) {
        const newUrl = res.headers.get('Location');
        if (newUrl) {
          window.location.assign(newUrl);
        }
        return '';
      }

      response = res;
      return res.text();
    })
    .then((content: string | boolean) => {
      // No content = DO NOTHING (redirect or something else happened)
      if (!content) {
        return '';
      }

      console.log('Got content =', content, response);

      Idiomorph.morph(form, content);
    });
}
