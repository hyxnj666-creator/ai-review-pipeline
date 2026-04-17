const OPENAI_API_KEY = 'sk-proj-1234567890abcdefghijklmnop';

export function getHeaders() {
  return {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  };
}
