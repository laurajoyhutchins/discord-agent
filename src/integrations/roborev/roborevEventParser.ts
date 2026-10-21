import type { Project } from '../../types.js';
import type { ReviewNotification } from '../reviewSource.js';
import type { RoborevStreamEvent } from './types.js';

export function matchProject(
  repoPath: string,
  projects: Project[],
): Project | undefined {
  const repo = repoPath.toLowerCase().replace(/\/+$/, '');
  let closest: Project | undefined;
  let closestLength = -1;
  for (const project of projects) {
    if (!project.roborevChannelId) continue;
    const directory = project.workingDirectory.toLowerCase().replace(/\/+$/, '');
    if (
      (repo === directory || repo.startsWith(`${directory}/`))
      && directory.length > closestLength
    ) {
      closest = project;
      closestLength = directory.length;
    }
  }
  return closest;
}

export function normalizeToNotification(
  event: RoborevStreamEvent,
  projectName: string,
): ReviewNotification {
  if (event.type === 'review.started') {
    return {
      source: 'roborev',
      projectId: projectName,
      revision: event.sha,
      status: 'started',
      summary: `Reviewing ${event.sha.slice(0, 8)}`,
      details: {
        agent: event.agent,
        timestamp: event.ts,
        sha: event.sha,
      },
    };
  }

  if (event.type === 'review.completed') {
    return {
      source: 'roborev',
      projectId: projectName,
      revision: event.sha,
      status: mapVerdictToStatus(event.verdict),
      summary: `Review ${event.sha.slice(0, 8)} — ${event.verdict ?? '?'}`,
      details: {
        verdict: event.verdict,
        agent: event.agent,
        jobId: event.job_id,
        sha: event.sha,
        timestamp: event.ts,
      },
    };
  }

  return {
    source: 'roborev',
    projectId: projectName,
    revision: event.sha,
    status: 'started',
    summary: `Event: ${event.type}`,
    details: { type: event.type, agent: event.agent, jobId: event.job_id },
  };
}

export function mapVerdictToStatus(verdict?: string): 'started' | 'passed' | 'warning' | 'failed' {
  switch (verdict) {
    case 'A': return 'passed';
    case 'B': return 'warning';
    case 'C': case 'D': case 'F': return 'failed';
    default: return 'warning';
  }
}
