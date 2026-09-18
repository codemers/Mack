import { Validator, type SchemaDraft } from '@cfworker/json-schema';

const drafts: Record<string, SchemaDraft> = {
  'http://json-schema.org/draft-04/schema': '4',
  'https://json-schema.org/draft-04/schema': '4',
  'http://json-schema.org/draft-07/schema': '7',
  'https://json-schema.org/draft-07/schema': '7',
  'https://json-schema.org/draft/2019-09/schema': '2019-09',
  'https://json-schema.org/draft/2020-12/schema': '2020-12',
};

// Remote schemas arrive at runtime, so validation must not use eval/new Function.
export function validateToolArguments(rawSchema: string, args: Record<string, unknown>) {
  const schema = JSON.parse(rawSchema);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    throw new Error('Invalid tool schema');
  const draft =
    schema.$schema === undefined
      ? '2020-12'
      : typeof schema.$schema === 'string'
        ? drafts[schema.$schema.replace(/#$/, '')]
        : undefined;
  if (!draft) throw new Error('Unsupported schema dialect');
  return new Validator(schema, draft).validate(args).valid;
}
