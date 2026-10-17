# Private company peer research v1

## Observed failure

When a user asks for peers of an AI video model post-training company without a ticker, the planner can reject the request as if a listed issuer were required. A follow-up such as “这家公司还没上市” then has no explicit subject and falls into generic plan validation failure.

## Intended behavior

- Treat an unlisted company as a valid research subject.
- Ask for the company or project name and comparison dimensions before discovery when either is missing.
- Ground the name in the user's current request or immediate follow-up context; generic phrases such as “这家公司” are not an identity. Do not repeat a request for information already supplied.
- Preserve the distinction between the private subject and the public peer set. A stock code is required only for a listed peer or issuer lookup.
- Suggested dimensions: model capability and product, customers and commercialization, financing and valuation, R&D team and compute, revenue and profitability.

## Evidence boundary

This slice only improves planning and clarification. It does not claim that CNINFO can discover private companies or automatically produce a peer set. A later adapter must map the supplied dimensions to public listed companies and other permitted sources.

## Verification

- Planner tests cover the initial peer request and the “not listed” follow-up.
- Planner tests also cover a named subject with explicit dimensions, and ensure an unrelated later request does not inherit an old peer-comparison intent.
- Existing research planning and live research tests remain required.
