import { now, type Workspace } from './domain';

// Stream updates only change one step; retain the rest of the workspace so
// reference previews and completed results can reuse their rendered content.
export function publishJobOutput(state: Workspace, jobId: string, stepId: string, output: string): Workspace {
  const job = state.jobs.find(item => item.id === jobId);
  const step = job?.steps.find(item => item.id === stepId);
  if (!job || !step || (step.output === output && step.status === 'running')) return state;
  return {
    ...state,
    updatedAt: now(),
    jobs: state.jobs.map(item => item !== job ? item : {
      ...job,
      steps: job.steps.map(item => item !== step ? item : { ...step, output, status: 'running' }),
    }),
  };
}
