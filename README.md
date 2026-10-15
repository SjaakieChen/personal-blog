# Jiaqi Chen's blog

Blog: https://sjaakiechen.github.io/personal-blog/
Writing desk: https://sjaakiechen.github.io/personal-blog/write/

## Write and publish

1. Open the writing desk in Microsoft Edge. Choose Blog post or Standalone page. Write a title, an optional opening quote, and paragraphs.
2. Drafts save in this browser. New draft keeps earlier drafts in the Saved drafts menu. Download backups before clearing browser data or changing computers.
3. Choose Prepare to publish, then Copy post and Open GitHub editor.
4. Sign in to GitHub if needed. The filename is prefilled. Paste the prepared content into the file editor, choose Commit changes, and commit directly to main.
5. GitHub Pages builds the update. Posts appear in the dated sidebar and get permanent URLs. Standalone pages get their own URLs, shown in the prepared content.

Edit published writing opens existing posts/pages in GitHub. Commit there to update them. Preparing a draft does not publish it; the GitHub commit does. GitHub login provides publishing authorization. No passwords or access tokens are stored in the website. Drafts use plain text and paragraph breaks, with a separate opening quote field.

Draft storage is local to the browser profile and site origin, not a cloud backup. The writing desk is publicly accessible; only repository writers can commit. The generated example posts are marked sample: true and can be edited or removed through GitHub.

## Structure

- _posts/: dated post files; six generated examples demonstrate the template.
- pages/: standalone pages created through the writing desk.
- _layouts/: blog shell, individual posts, and standalone pages.
- index.html: all posts, newest first.
- write.html and assets/writer*: writing desk and draft handling.
- styles.css: selected typography, white page, blue headings, and independently scrolling timeline sidebar.
- assets/fonts/: self-hosted EB Garamond with its OFL license.
- local-playground/: ignored local design experiment; not deployed.

## Publishing and checks

Pages uses the Publish blog GitHub Actions workflow and Jekyll. Pushes to main rebuild it; .nojekyll must stay absent. _config.yml contains the project base URL. Future dates display immediately rather than being scheduled (future: true).

Run `node --test scripts/writer.test.cjs` for publishing-format and text-escaping checks. GitHub's Pages build validates Jekyll templates. A local Jekyll preview needs the /personal-blog/ base path. The existing port 4173 playground remains a separate local-only design tool.

## Publication and edit timestamps

The build reads each post/page's Git history with full history available. Its first commit supplies the original publication timestamp; later commits to that file supply the Edited timestamp. Styling-only changes do not mark posts edited. Metadata is added only to the build copy, never committed back. Drafts also record their local save time. The editor Date field controls the post filename and sort date; the visible publication time records the actual first commit.
