# Personal blog

Blog: https://sjaakiechen.github.io/personal-blog/
Private editor: https://yoga-jiaqi.taile0df21.ts.net:8446/write/

The earlier public editor at https://sjaakiechen.github.io/personal-blog/write/ transfers existing local drafts when opening the private desk.

## Writing

Write directly in the page: click the title or body. The editor uses the same stylesheet, font files, reading width, weights, sizes, paragraph spacing, and colours as the published blog. The optional opening quote is always editable below the title. Select body text and use B, I, or U, or the usual Ctrl+B / Ctrl+I / Ctrl+U shortcuts. Supported rich formatting is paragraphs, line breaks, bold, italic, and underline.

The editor sidebar separates Drafts (never published), Edits (unpublished changes to a live post), and Published. Published has separate Blog and Archive groups, newest first within each, with empty groups hidden. A live post always remains under Published, even when it also has an Edits entry. Published shows the live text; when saved edits exist, that view is read-only and Resume edits returns to the working copy. Selecting Edits opens those saved changes directly. Opening a published post without existing edits allows writing immediately. Publishing clears the Edits entry; text typed while a publication is in flight stays under Edits. Discard edits keeps the live version. New draft preserves earlier work. Publication and last-edit timestamps come from Git automatically; template-only updates do not change them.

Publish sends the post directly through the private Yoga service to GitHub and reports the Pages deployment status. Connect GitHub is a one-time device sign-in; the credential stays on Yoga. The private desk requires the owner’s Tailscale connection. Posts receive their own URLs; Archive creates supporting material outside the dated feed. See publisher/README.md for operations, security boundaries, and restart details.

## Draft persistence

Edits autosave in localStorage and sync to Yoga from the private desk. Drafts survive normal tab/browser closure and computer restarts. A previous-state backup is retained locally and on Yoga. The public transfer page stores drafts only in that browser; clearing its site data can remove them. Save JSON provides an independent backup.

Save JSON downloads all drafts, including formatting, as JSON. Import JSON merges them without replacing existing drafts. Keep a backup outside the browser for important writing. The editor preserves older plain-text drafts when upgrading them to rich text.

## Source and deployment

- _posts/: actual posts. Generated samples were removed.
- pages/: standalone archive entries.
- _layouts/ and _includes/: shared reading layout and publication/edit times.
- write.html and assets/writer*: direct-editing page, sidebar, rich document format, and local drafts.
- writing-index.json: public post/page content for the editor sidebar.
- assets/fonts/: EB Garamond and its OFL license.
- local-playground/: ignored design experiment, not deployed.

The Publish blog workflow builds Jekyll and deploys to Pages after a push to main. scripts/post_timestamps.py reads first/latest file commits from full Git history and adds timestamps to the build copy. These derived fields are never committed back. The original post date is kept when editing.

Checks: node --test scripts/writer.test.cjs and python -m unittest discover -s scripts -p 'test_*.py'.

## References

Posts are the writing feed. Archive entries are supporting material, linked from citations rather than included in the feed. In the editor, Reference opens the source picker: reuse a source, choose a published archive entry, or enter a URL/PDF link with title, author and publication details. Add an optional saved-copy link and a page/section locator. Select body text and check Quote the selected text to insert a cited quotation. The opening quote has its own Choose quote source control. Publishing requires sources for opening quotes and text marked as quotations.

Sources appear as numbered inline citations and a References list, using the same fonts and layout in the editor and published page. Edit source changes the shared source entry. References, quote attribution and formatted citations are included in local drafts and JSON backups, and in published metadata so they can be reopened for editing. New archive entry creates an archive draft; publish it before selecting it from another post. PDF links and saved-copy links do not upload or archive a document automatically.

Evidence archive entries use the normal draft and Publish workflow with a fixed permalink. Store their original PDFs under `assets/evidence/` and add the permalink, site-relative `pdf` path, absolute public `public_pdf` URL and accessible title to `_data/evidence.json`. Optional `previews` list rendered poster pages, shown beside the text and linked to the original PDF so browsers without a PDF viewer can still display the poster. Otherwise the public template embeds the PDF with a download fallback. Keep a direct PDF link in the draft too. The same manifest feeds the public site and private writer, so a known PDF link also displays its poster previews while editing. This metadata stays separate from editable writing and preserves the stable PDF URL.

Blog posts, the feed, Archive entries and the writing desk use a right-hand media pane whenever media is present. Ordinary links and named citations to supported YouTube videos generate privacy-enhanced video players in that pane; repeated links produce one player, and reference/notes lists do not generate duplicates. Known PDFs use the shared manifest; existing public images, video and audio also display beside the text. Text links remain available as fallbacks, and the editor never inserts media into the saved rich-text document. Text-only articles retain their normal width with no empty media area. On narrow screens the pane stacks below the text.

The home feed collapses long posts with Show more / Show less; individual post pages always show the complete article. Clicking a citation expands a collapsed article before following its reference target. Without JavaScript, the full text is available.

The main blog is a continuous feed, newest first. Sidebar links jump to a post in that feed in the same tab, including when starting from a standalone post URL. Post titles in the feed remain within that document. References to other pages and external sources still open separately.

Select a published post in the writing sidebar, then Delete post to remove it from the public blog after confirmation. A local draft copy stays available, and Git history preserves the removed version. Deletion checks the original file revision and rejects concurrent changes. The GitHub status control is a green/red dot with an accessible label; click it to inspect or connect.
