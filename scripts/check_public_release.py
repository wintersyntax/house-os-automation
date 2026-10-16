#!/usr/bin/env python3
"""Conservative public extraction gate; human release review is still required."""
from __future__ import annotations
import pathlib
import re
import sys

APPROVED_EXACT = {
    '.github/workflows/portfolio-ci.yml', '.gitignore', '.env.example',
    'README.md', 'CHANGELOG.md', 'LICENSE', 'package.json',
    'docs/ARCHITECTURE.md', 'docs/IMPLEMENTATION_STATUS.md',
    'docs/AI_SAFETY.md', 'docs/DEMO.md', 'docs/SECURITY.md',
    'docs/ROADMAP.md', 'docs/EXTRACTION_SUMMARY.json',
    'examples/synthetic-household.json',
    'scripts/preview-daily-brief.mjs', 'scripts/check_public_release.py',
    'demos/husbot-simulation.mjs', 'demos/failure-modes.mjs',
}
APPROVED_SRC = {
    'src/husbot/cloud-main.js', 'src/husbot/cloud-platform.js',
    'src/husbot/cloud-worker.js', 'src/husbot/daily-brief.js',
    'src/husbot/facts.js', 'src/husbot/live-reply.js',
    'src/husbot/openrouter-draft.js', 'src/husbot/slack-events.js',
    'src/husbot/slack-http.js', 'src/husbot/slack-test.js',
    'src/trello/inventory-probe.js', 'src/trello/inventory.js',
    'src/trello/read-only.js',
}
APPROVED_TESTS = {
    'tests/husbot-daily-brief.test.js', 'tests/husbot-facts.test.js',
    'tests/husbot-mvp-pipeline.test.js', 'tests/husbot-mvp.test.js',
    'tests/husbot-slack-events.test.js', 'tests/trello-inventory.test.js',
}
EXPECTED = APPROVED_EXACT | APPROVED_SRC | APPROVED_TESTS
ALLOWED_MOCK = 'xoxb-' + 'portfolio-synthetic-placeholder'

# These checks target common disclosure classes. They do not detect everything.
RULES = (
    ('OpenRouter credential', re.compile(r'sk-or-v1-[A-Za-z0-9_-]{12,}')),
    ('GitHub credential', re.compile(r'gh(?:p|o|u|s|r)_[A-Za-z0-9]{24,}')),
    ('Google API credential', re.compile(r'AIza[A-Za-z0-9_-]{30,}')),
    ('PEM private key', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
    ('Slack webhook', re.compile(r'https://hooks[.]slack[.]com/services/[A-Za-z0-9/_-]+')),
    ('Make webhook', re.compile(r'https://hook(?:[.]eu\d+)?[.]make[.]com/[A-Za-z0-9_-]{10,}')),
    ('personal home folder', re.compile(r'/Users/(?!YOUR_USER(?:/|\b))[A-Za-z0-9._-]+/')),
    ('personal email', re.compile(r'[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook)[.]com', re.I)),
    ('private Cloud Run URL', re.compile(r'https://[a-z0-9-]+(?:[.][a-z0-9-]+)*[.]run[.]app(?:/|\b)', re.I)),
    ('local private CI runner', re.compile(r'petars[-]macbook[-]air[-]house[-]os(?:-app)?', re.I)),
)
SLACK_TOKEN = re.compile(r'xox[baprs]-[A-Za-z0-9-]{10,}')

def scan(root: pathlib.Path) -> list[str]:
    errors = []
    found = set()
    if not root.is_dir():
        return ['Portfolio root missing']
    for path in root.rglob('*'):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            # Check BEFORE is_dir(): a symlink to a directory is also is_dir().
            errors.append(f'{relative}: symlinks are forbidden')
            continue
        if '.git' in path.relative_to(root).parts:
            # The generated candidate has no Git metadata; a new public Git
            # checkout may contain its own metadata after the owner publishes.
            continue
        if path.is_dir():
            # Unapproved/generated directories are not needed for this
            # dependency-free portfolio and should never be staged.
            if relative.split('/')[0] in {'node_modules', '__pycache__', '.pytest_cache'}:
                errors.append(f'{relative}: unapproved generated directory')
            continue
        found.add(relative)
        if relative not in EXPECTED:
            errors.append(f'{relative}: not in positive release allowlist')
            continue
        if path.stat().st_size > 200_000:
            errors.append(f'{relative}: file exceeds review size limit')
        try:
            content = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            errors.append(f'{relative}: non-text or unreadable content')
            continue
        # Exactly one fictional Cloud Run test fixture is allowlisted.
        # Its hostname is split here so this scanner does not flag itself.
        public_scan_content = content
        if relative in {'tests/husbot-mvp-pipeline.test.js', 'tests/husbot-mvp.test.js'}:
            public_scan_content = content.replace('https://portfolio-fixture-not-deployed.' + 'run.app', '')
        for name, pattern in RULES:
            if pattern.search(public_scan_content):
                errors.append(f'{relative}: suspicious {name}')
        for match in SLACK_TOKEN.finditer(content):
            if not (relative in APPROVED_TESTS and match.group(0) == ALLOWED_MOCK):
                errors.append(f'{relative}: Slack token-like value is not the canonical test placeholder')
    # Fail if any of the intended public extraction content is missing.
    for required in EXPECTED - found:
        errors.append(f'{required}: required file missing')
    return sorted(set(errors))

if __name__ == '__main__':
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    failures = scan(root)
    for issue in failures:
        print('RELEASE RED:', issue, file=sys.stderr)
    if failures:
        sys.exit(1)
    print(f'RELEASE CHECK: PASS ({len(EXPECTED)} approved UTF-8 files; review still required)')
