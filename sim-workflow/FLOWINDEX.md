# FlowIndex Sim Workflow Fork

This directory vendors the Sim Studio fork source used by `studio.flowindex.io`.

## Build path

CI builds images from this directory:

- `docker/app.Dockerfile`
- `docker/realtime.Dockerfile`
- `docker/db.Dockerfile`

## Auth integration

FlowIndex auth is integrated in app code and uses:

- `FLOWINDEX_AUTH_MODE=supabase_cookie`
- `SUPABASE_JWT_SECRET`
- shared cookie `fi_auth` on `.flowindex.io`

## Deployment

Deployment workflow is in:

- `.github/workflows/deploy.yml` (`build-simstudio-fork-image` + `build-sim-studio`)
