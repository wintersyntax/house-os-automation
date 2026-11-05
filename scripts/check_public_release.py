#!/usr/bin/env python3
"""Public snapshot privacy checks; supplementary to explicit human source review."""
from __future__ import annotations
import argparse
from pathlib import Path
import re
import subprocess

SKIP_DIRS = {'.git', 'node_modules', '__pycache__'}
SKIP_NAMES = {'.DS_Store'}
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', re.I)
USER_NOREPLY = re.compile(r'[A-Za-z0-9+_.-]+@users\.noreply\.github\.com', re.I)
GITHUB_COMMITTER = re.compile(r'\bnoreply@github\.com\b', re.I)
SECRETS = [
    ('Slack token', re.compile(r'xox[baprs]-[A-Za-z0-9-]{15,}')),
    ('API key', re.compile(r'AIza[0-9A-Za-z_-]{24,}')),
    ('GitHub token', re.compile(r'gh[pousr]_[A-Za-z0-9]{20,}')),
    ('private key', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
    ('credential assignment', re.compile(r'(?i)(?:api_key|password|access_token|refresh_token|client_secret)\s*[:=]\s*["\'](?!(?:example|fake|synthetic|test|your)[-_])[^"\']{16,}["\']')),
]
PRIVATE_PATH = re.compile(r'(?i)(/Users/[a-z0-9._-]{2,}/|/home/[a-z0-9._-]{2,}/)')
DANGEROUS = re.compile(r'(^|/)(?:\.env(?:\..+)?|id_rsa|id_ed25519|.*\.(?:pem|p12|pfx|key)|\.npmrc|\.netrc)$', re.I)
ALLOWED_ROOT_FILES = {'.gitignore','LICENSE','README.md','package.json'}
ALLOWED_TOP_DIRS = {'.github','demos','docs','examples','scripts','src','tests'}


def scan_text(path: str, content: str, *, commit: bool = False) -> list[str]:
    clean = USER_NOREPLY.sub('', content)
    if commit:  # GitHub-generated squash commits are signed by this platform identity.
        clean = GITHUB_COMMITTER.sub('', clean)
    findings = []
    if EMAIL.search(clean):
        findings.append(f'{path}: possible personal email')
    for name, pattern in SECRETS:
        if pattern.search(clean):
            findings.append(f'{path}: possible {name}')
    if PRIVATE_PATH.search(clean):
        findings.append(f'{path}: absolute user home path')
    return findings


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL)


def check(root: Path, history: bool = False) -> list[str]:
    errors = []
    for file in root.rglob('*'):
        relative = file.relative_to(root)
        if any(x in SKIP_DIRS for x in relative.parts) or file.name in SKIP_NAMES:
            continue
        path = relative.as_posix()
        if file.is_symlink():
            errors.append(f'{path}: symlink forbidden')
            continue
        if not file.is_file():
            continue
        if (DANGEROUS.search(path) and path != '.env.example') or \
           (len(relative.parts) == 1 and path not in ALLOWED_ROOT_FILES) or \
           (len(relative.parts) > 1 and relative.parts[0] not in ALLOWED_TOP_DIRS):
            errors.append(f'{path}: disallowed public path')
            continue
        try:
            errors.extend(scan_text(path, file.read_text(encoding='utf-8')))
        except UnicodeDecodeError:
            errors.append(f'{path}: binary or non-UTF8')
    for name in ['README.md','package.json','.github/workflows/portfolio-ci.yml']:
        if not (root / name).is_file():
            errors.append(f'{name}: required public file missing')
    if history:
        try:
            commits = git(root,'rev-list','--all','HEAD').decode().splitlines()
            if len(commits) != 1:
                errors.append(f'expected exactly one Initialize commit; found {len(commits)}')
            for sha in commits:
                raw = git(root,'cat-file','commit',sha).decode()
                errors.extend(scan_text(f'commit {sha[:12]}',raw,commit=True))
                if git(root,'rev-list','--parents','-n','1',sha).decode().count(' ') != 0:
                    errors.append(f'commit {sha[:12]}: not an independent root')
                for path in git(root,'ls-tree','-r','--name-only',sha).decode().splitlines():
                    contents = git(root,'show',f'{sha}:{path}').decode()
                    errors.extend(scan_text(f'history {path}',contents))
            for ref in git(root,'for-each-ref','--format=%(objectname)').decode().splitlines():
                if git(root,'cat-file','-t',ref).strip() == b'tag':
                    errors.append('annotated tag requires review')
        except (OSError,subprocess.CalledProcessError,UnicodeDecodeError):
            errors.append('Git history evidence unavailable')
    return sorted(set(errors))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root',nargs='?',default='.')
    parser.add_argument('--history',action='store_true')
    args = parser.parse_args()
    failures = check(Path(args.root).resolve(),args.history)
    for item in failures:
        print('RELEASE RED:',item)
    if failures:
        raise SystemExit(1)
    print('RELEASE GREEN: public tree and'+(' single-root history' if args.history else ' content'))


if __name__=='__main__': main()
