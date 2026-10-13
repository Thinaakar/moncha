import { describe, expect, it } from 'vitest';
import { FIXTURE_NOW, siteSnapshotFixture } from './__fixtures__/site-snapshot';
import { siteCopyProgress } from './siteProgress';

const both = { githubEnabled: true, workerEnabled: true };
const states = (p: ReturnType<typeof siteCopyProgress>) => Object.fromEntries(p.steps.map((s) => [s.step, s.state]));

describe('siteCopyProgress', () => {
  it('shows a new copy as queued', () => {
    const p = siteCopyProgress(siteSnapshotFixture({ status: 'pending', attempts: 0, githubStatus: null }), both);
    expect(p).toMatchObject({ step: 'queued', state: 'waiting', since: FIXTURE_NOW });
    expect(p.steps.map((s) => s.step)).toEqual(['queued', 'copying', 'reading_source', 'building', 'updating_git', 'deploying_url', 'live']);
  });

  it('shows the step a running copy is on', () => {
    const at = new Date('2026-10-09T10:01:00.000Z');
    const p = siteCopyProgress(siteSnapshotFixture({ status: 'running', stage: 'reading_source', stageAt: at, githubStatus: null }), both);
    expect(p).toMatchObject({ step: 'reading_source', state: 'active', since: at, error: null });
    expect(states(p)).toMatchObject({ queued: 'done', copying: 'done', reading_source: 'active', building: 'not_started', updating_git: 'not_started' });
  });

  it('keeps the failed step and its error', () => {
    const row = siteSnapshotFixture({ status: 'failed', stage: 'building', failureReason: 'upload_failed', failureDetail: 'R2 503', githubStatus: null });
    expect(siteCopyProgress(row, both)).toMatchObject({ step: 'building', state: 'failed', error: 'R2 503' });
  });

  it('shows a copy waiting for a retry as retrying', () => {
    const row = siteSnapshotFixture({ status: 'pending', attempts: 1, stage: 'copying', failureReason: 'render_failed', githubStatus: null });
    expect(siteCopyProgress(row, both)).toMatchObject({ step: 'copying', state: 'retrying', error: 'render_failed' });
  });

  it('moves to the GitHub push once the copy is done, before the Worker', () => {
    const next = new Date('2026-10-09T10:05:00.000Z');
    const row = siteSnapshotFixture({ githubStatus: 'pending', githubAttempts: 0, githubNextAt: next, workerStatus: 'pending', workerNextAt: next });
    const p = siteCopyProgress(row, both);
    expect(p).toMatchObject({ step: 'updating_git', state: 'waiting', nextAt: next });
    expect(states(p)).toMatchObject({ building: 'done', updating_git: 'waiting', deploying_url: 'waiting', live: 'not_started' });
  });

  it('shows a GitHub error while the push retries', () => {
    const row = siteSnapshotFixture({ githubStatus: 'pending', githubAttempts: 2, githubError: 'GitHub rate limit reached' });
    expect(siteCopyProgress(row, both)).toMatchObject({ step: 'updating_git', state: 'retrying', error: 'GitHub rate limit reached' });
  });

  it('deploys the URL after the push and ends live', () => {
    const pushedAt = new Date('2026-10-09T10:02:00.000Z');
    const deployedAt = new Date('2026-10-09T10:03:00.000Z');
    const deploying = siteSnapshotFixture({ githubStatus: 'pushed', githubPushedAt: pushedAt, workerStatus: 'deploying', workerAttempts: 1 });
    expect(siteCopyProgress(deploying, both)).toMatchObject({ step: 'deploying_url', state: 'active' });

    const live = siteSnapshotFixture({ githubStatus: 'pushed', githubPushedAt: pushedAt, workerStatus: 'deployed', workerDeployedAt: deployedAt });
    const p = siteCopyProgress(live, both);
    expect(p).toMatchObject({ step: 'live', state: 'done', since: deployedAt });
    expect(p.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('leaves out GitHub and Worker steps that are not configured or used', () => {
    const p = siteCopyProgress(siteSnapshotFixture({ githubStatus: null, workerStatus: null }), { githubEnabled: false, workerEnabled: false });
    expect(p.steps.map((s) => s.step)).toEqual(['queued', 'copying', 'reading_source', 'building']);
    expect(p).toMatchObject({ step: 'building', state: 'done', since: FIXTURE_NOW });

    const workerOnly = siteCopyProgress(siteSnapshotFixture({ githubStatus: null, workerStatus: 'pending' }), { githubEnabled: false, workerEnabled: true });
    expect(workerOnly).toMatchObject({ step: 'deploying_url', state: 'waiting' });
  });

  it('marks a configured step that was never queued as not started', () => {
    const p = siteCopyProgress(siteSnapshotFixture({ githubStatus: null, workerStatus: null }), both);
    expect(p).toMatchObject({ step: 'updating_git', state: 'not_started' });
  });
});
