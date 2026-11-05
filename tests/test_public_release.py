import unittest
from scripts.check_public_release import scan_text

class ScannerTest(unittest.TestCase):
    def test_blocks_personal_email(self):
        self.assertTrue(scan_text('fixture', 'a person' + '@' + 'private-domain.test'))

    def test_accepts_verified_user_noreply(self):
        self.assertFalse(scan_text('commit', '301267195+wintersyntax@users.noreply.github.com', commit=True))

    def test_accepts_github_system_committer_only_in_commit(self):
        system = 'noreply' + '@github.com'
        self.assertFalse(scan_text('commit', system, commit=True))
        self.assertTrue(scan_text('source', system))

    def test_blocks_other_github_email(self):
        self.assertTrue(scan_text('commit', 'personal'+'@github.com', commit=True))

    def test_blocks_slack_token(self):
        self.assertTrue(scan_text('fixture', 'xoxb-'+'a'*40))

    def test_accepts_fictional_norwegian_examples(self):
        self.assertFalse(scan_text('fixture','Fictional coffee · HANDLELISTE · KJØP'))

if __name__ == '__main__': unittest.main()
