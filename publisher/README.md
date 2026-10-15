# Private publisher on Yoga

Writing desk: https://yoga-jiaqi.taile0df21.ts.net:8446/write/

The public blog remains on GitHub Pages. The private desk runs on Yoga behind Tailscale Serve. Only the configured owner's Tailscale identity is accepted. It listens on loopback port 8767; Serve supplies HTTPS and verified identity headers on port 8446. Existing Serve routes are preserved, and Funnel remains disabled.

Connect GitHub starts the official GitHub CLI device-login flow. The owner signs into SjaakieChen at github.com/login/device and authorizes GitHub CLI. The credential remains on Yoga in a dedicated, owner-only state directory; no token is sent to the frontend, public repository, browser storage, or draft backups. This uses GitHub CLI's usual OAuth authorization. The publisher itself permits writes only to `_posts/*.md` and `pages/*.md` in `SjaakieChen/personal-blog`, branch main.

Publish validates the document, sends it to Yoga, commits through GitHub's Contents API, and polls the Pages workflow for the resulting commit. Existing documents require the source blob SHA from the deployed index. Concurrent edits return a conflict instead of overwriting. An identical retry detects an already-successful write without making a duplicate commit. Original publication time and later edits continue to come from Git history.

The public writer's Publish/Open private desk buttons transfer drafts into the private desk through a checked window-to-window message. Both origin and window identity are checked; the transfer retains the original browser copy and keeps conflicting private drafts. Drafts still autosave to that browser's localStorage and can be backed up/restored as JSON. They are not server-synced drafts.

## Operations

- Source deployment: `/home/jiaqi/.local/share/blog-publisher`.
- Private state: `/home/jiaqi/.local/state/blog-publisher`, directory mode 0700. GitHub CLI's dedicated config is below `github/`; files are created with umask 0077. This is outside YogaCloud and source control.
- Service: `blog-publisher.service`, system unit running as jiaqi, enabled at boot and restarted on failure.
- Environment: `/etc/blog-publisher.env`, root-owned mode 0600, containing owner identity/origin/port/state location.
- Check: `ssh yoga-jiaqi "systemctl is-active blog-publisher.service"`.
- Restart only this service: `ssh yoga-jiaqi "sudo -n systemctl restart blog-publisher.service"`.
- Deploy changed application files to the source deployment and restart the service. Do not replace the private state directory. Do not print/copy its credential files.
- Disconnect deliberately through GitHub Settings → Applications → Authorized OAuth Apps → GitHub CLI. This may affect other GitHub CLI installations using the same authorization; do not revoke as routine troubleshooting.

Yoga must be powered and online, and the writing device must be connected to Tailscale. The service and saved GitHub connection survive normal service/computer restarts. GitHub revocation, credential expiry or deletion, network loss, or disk loss can require repair or reauthentication. No perpetual-login or independent disk-backup guarantee is made.

Tests: `python -m unittest discover -s scripts -p 'test_*.py'` and `node --test scripts/writer.test.cjs`.

Select a published post in the writing sidebar, then Delete post to remove it from the public blog after confirmation. A local draft copy stays available, and Git history preserves the removed version. Deletion checks the original file revision and rejects concurrent changes. The GitHub status control is a green/red dot with an accessible label; click it to inspect or connect.
