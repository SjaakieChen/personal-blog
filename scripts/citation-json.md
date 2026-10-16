# Citation JSON

Ask an assistant to verify the source, exact quotation and locator, then produce a
UTF-8 JSON file using this format. Identify the edition or translation; leave
unknown author/date fields empty. Do not invent source metadata or saved-copy URLs.

```json
{
  "type": "blog-citation",
  "version": 1,
  "source": {
    "title": "Source title",
    "url": "https://example.org/source",
    "author": "",
    "details": "Edition, year, journal, DOI, etc., if verified",
    "savedUrl": "",
    "note": ""
  },
  "locator": "p. 12",
  "quote": "Exact quoted text; omit if only inserting a reference."
}
```

Use Import JSON in the writer toolbar, or Reference → Import citation JSON.
The review dialog can insert the quote and numbered reference in the body, insert
only a reference after selected text, or set the opening quote and its reference.
No post is published by importing. The existing draft JSON import still works.
Quotation marks are never added. Source metadata and quoted text are stored with
the draft and published post, but importing does not archive the linked webpage
or PDF. Only set savedUrl when a saved copy actually exists.

The importer validates types and URLs; it cannot verify that a quotation or
AI-supplied source is accurate. Text is escaped when rendered. Sources with the
same exact URL are reused within a post to keep reference numbers consistent.
