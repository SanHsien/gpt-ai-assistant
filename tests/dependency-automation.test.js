import {
  expect, test,
} from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Dependabot review and merge workflows preserve strict gates', () => {
  const review = read('.github/workflows/dependabot-review.yml');
  const merge = read('.github/workflows/dependabot-merge.yml');

  expect(review).toContain('pull_request_target:');
  expect(review).toContain('github.event.pull_request.base.sha');
  expect(review).toContain('persist-credentials: false');
  expect(review).toContain('Dependabot policy');
  expect(review).toContain('25dd0e34f4fe68f24cc83900b1fe3fe149efef98');
  expect(review).toContain('gh label create "dependencies-auto-merge"');
  expect(merge).toContain('group: dependabot-merge-queue');
  expect(merge).toContain('cancel-in-progress: false');
  expect(merge).toContain('author" != "app/dependabot"');
  expect(merge).toContain('dependencies-auto-merge');
  expect(merge).toContain('dependencies-manual-review');
  expect(merge).toContain('app.slug == "github-actions"');
  expect(merge).toContain('--match-head-commit');
  expect(merge).toContain('"test" "docker-smoke" "Analyze (JavaScript/TypeScript)"');
  expect(merge).toContain('gh workflow run dependency-freshness.yml');
});

test('freshness workflow owns and resolves one maintenance issue', () => {
  const freshness = read('.github/workflows/dependency-freshness.yml');
  expect(freshness).toContain('gh label create dependencies');
  expect(freshness).toContain('group: dependency-freshness');
  expect(freshness).toContain('cancel-in-progress: true');
  expect(freshness).toContain('package-lock.json');
  expect(freshness).toContain('--author app/dependabot');
  expect(freshness).toContain('--state all');
  expect(freshness).toContain('gh issue reopen "$issue"');
  expect(freshness).toContain('checked_sha="$(git rev-parse HEAD)"');
  expect(freshness).toContain('--add-assignee "$GITHUB_REPOSITORY_OWNER"');
  expect(freshness).toContain('--add-label dependencies');
  expect(freshness).toContain('gh issue edit "$issue" --body-file');
  expect(freshness).toContain('gh issue close "$issue"');
});
