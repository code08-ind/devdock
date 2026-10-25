/** Recorded-style Jenkins payloads (trimmed to the fields DevDock asks for with `tree=`). */

export { ScriptedHttp, json, type Route } from './jira'

export const JENKINS = 'https://ci.example.com/jenkins'

const MULTIBRANCH = 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject'
const PIPELINE = 'org.jenkinsci.plugins.workflow.job.WorkflowJob'

export const jenkins = {
  me: { _class: 'hudson.model.User', id: 'ada', fullName: 'Ada Example' },
  crumb: {
    _class: 'hudson.security.csrf.DefaultCrumbIssuer',
    crumb: 'c0ffee',
    crumbRequestField: 'Jenkins-Crumb',
  },
  /** `GET /job/web-app/api/json?tree=…` */
  webApp: {
    _class: MULTIBRANCH,
    jobs: [
      {
        _class: PIPELINE,
        name: 'develop',
        lastBuild: {
          _class: 'org.jenkinsci.plugins.workflow.job.WorkflowRun',
          number: 230,
          result: 'SUCCESS',
          building: false,
          timestamp: 1_761_300_000_000,
          duration: 171_000,
          estimatedDuration: 170_000,
        },
      },
      {
        _class: PIPELINE,
        name: 'feature%2FNM-7-summary-card',
        lastBuild: {
          number: 5,
          result: null,
          building: true,
          timestamp: 1_761_310_000_000,
          duration: 0,
          estimatedDuration: 170_000,
        },
      },
      {
        _class: PIPELINE,
        name: 'PR-42',
        lastBuild: {
          number: 3,
          result: 'FAILURE',
          building: false,
          timestamp: 1_761_305_000_000,
          duration: 95_000,
          estimatedDuration: -1,
        },
      },
      // Never built.
      { _class: PIPELINE, name: 'spike%2Fnothing-yet', lastBuild: null },
      // A server-sent name that must never reach a URL.
      { _class: PIPELINE, name: '..', lastBuild: null },
    ],
  },
  /** `wfapi/describe` of a failed build. */
  describe: {
    id: '3',
    name: '#3',
    status: 'FAILED',
    stages: [
      {
        id: '6',
        name: 'Checkout',
        status: 'SUCCESS',
        startTimeMillis: 1_761_305_000_100,
        durationMillis: 4_000,
      },
      {
        id: '12',
        name: 'Unit tests',
        status: 'FAILED',
        startTimeMillis: 1_761_305_004_100,
        durationMillis: 61_000,
      },
      { id: '20', name: 'Build', status: 'NOT_EXECUTED', startTimeMillis: 0, durationMillis: 0 },
    ],
  },
  /** `GET /job/web-app/job/PR-42/3/api/json?tree=…` */
  build: {
    _class: 'org.jenkinsci.plugins.workflow.job.WorkflowRun',
    number: 3,
    result: 'FAILURE',
    building: false,
    timestamp: 1_761_305_000_000,
    duration: 95_000,
    estimatedDuration: 170_000,
    actions: [
      {
        _class: 'hudson.model.CauseAction',
        causes: [{ shortDescription: 'Pull request #42 updated' }],
      },
      {
        _class: 'hudson.model.ParametersAction',
        parameters: [
          { _class: 'hudson.model.StringParameterValue', name: 'TARGET', value: 'dev' },
          { _class: 'hudson.model.BooleanParameterValue', name: 'SKIP_E2E', value: true },
          { _class: 'hudson.model.PasswordParameterValue', name: 'NPM_TOKEN', value: null },
        ],
      },
      {},
    ],
  },
}
