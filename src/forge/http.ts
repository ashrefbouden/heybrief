// One place that turns a Jira/Confluence response into JSON.
//
// Many write endpoints succeed with an EMPTY body on statuses other than 204: for example
// PUT /issue/{key}/properties/{p} (200/201) and POST /issueLink (201). Calling res.json() on those
// throws "Unexpected end of JSON input". So read the text first and parse only when there is some.

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Throws on a non-2xx status. Returns undefined for an empty body. */
export async function readJson<T>(res: HttpResponse, product = 'Jira'): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${product} ${res.status}: ${text.slice(0, 200)}`);
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${product} ${res.status}: response was not JSON: ${text.slice(0, 120)}`);
  }
}
