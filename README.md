# Automated Deployment Pipeline

A continuous integration and continuous deployment pipeline that automatically tests, containerizes, and deploys a Node.js application from a Git commit to a running Kubernetes cluster — with zero manual steps.

> **Built as a study of CI/CD orchestration patterns using Jenkins (declarative Groovy pipelines), Docker, and Kubernetes.**

---

## Problem statement

Manual deployment is slow, inconsistent, and error-prone. Teams need a system where committing code to the main branch automatically results in:

1. The code being tested
2. A versioned container image being built and published
3. The new image being rolled out to the target environment with zero downtime
4. Clear feedback if any stage fails

This project implements that loop end-to-end with industry-standard tooling, demonstrates the design trade-offs at each layer, and produces a pipeline that is portable across different Git repositories and Kubernetes clusters.

---

## Architecture

```
   ┌──────────────┐    git push     ┌──────────────┐
   │  Developer   │ ──────────────▶ │   GitHub     │
   └──────────────┘                 └──────┬───────┘
                                           │ poll / webhook
                                           ▼
                                    ┌──────────────┐
                                    │   Jenkins    │
                                    │  (Groovy)    │
                                    └──────┬───────┘
                                           │
        ┌──────────────────┬───────────────┼───────────────┬──────────────────┐
        ▼                  ▼               ▼               ▼                  ▼
   ┌─────────┐       ┌──────────┐    ┌──────────┐   ┌────────────┐    ┌──────────────┐
   │Checkout │       │   Test   │    │  Build   │   │   Push     │    │   Deploy     │
   │  (git)  │       │ npm test │    │ docker   │   │ Docker Hub │    │  kubectl     │
   └─────────┘       └──────────┘    │  build   │   └────────────┘    │  apply       │
                                     └──────────┘                      └──────┬───────┘
                                                                              │
                                                                              ▼
                                                                     ┌────────────────┐
                                                                     │   Kubernetes   │
                                                                     │   Deployment   │
                                                                     │   (2 replicas) │
                                                                     └────────────────┘
```

---

## Technology choices and rationale

| Layer | Choice | Why this over alternatives |
|---|---|---|
| Source control | **GitHub** | Universal, free for public repos, native webhook support |
| CI/CD orchestrator | **Jenkins** | Industry standard, plugin ecosystem, declarative pipelines via Groovy, self-hostable. Chosen over GitHub Actions to demonstrate the more general orchestration pattern. |
| Pipeline definition | **Declarative Jenkinsfile (Groovy)** | Version-controlled with the code; reviewable; portable across Jenkins instances |
| Image registry | **Docker Hub** | Free public tier, no infra required. Production would use ECR/GCR/private Harbor. |
| Container runtime | **Docker** | Universally supported by Jenkins and Kubernetes |
| Orchestrator | **Kubernetes (Minikube locally)** | Industry-standard for container orchestration; same APIs as managed clusters (EKS/GKE/AKS) |
| Trigger mechanism | **Jenkins SCM polling** | Works without exposing Jenkins to the public internet. Production setup would use GitHub webhooks. Trade-off documented below. |

---

## Repository layout

```
automated-deployment-pipeline/
├── app.js              # Node.js HTTP server with /health endpoint
├── test.js             # Black-box integration tests run by `npm test`
├── package.json        # Node project metadata + scripts
├── Dockerfile          # Container build definition
├── .dockerignore       # Excludes dev files from the image
├── .gitignore          # Standard Node/macOS ignore list
├── Jenkinsfile         # Declarative pipeline (added in Phase 6)
├── k8s/
│   └── deployment.yaml # Kubernetes Deployment + Service with health probes
├── LICENSE             # MIT
└── README.md
```

---

## Pipeline stages

Each stage in the `Jenkinsfile` has a single responsibility:

| # | Stage | What it does | Failure handling |
|---|---|---|---|
| 1 | **Checkout** | Clones the repo at the triggering commit | Pipeline fails immediately if the repo or branch is unreachable |
| 2 | **Test** | Runs `npm test` against `app.js` (integration test of HTTP endpoints) | Stops the pipeline — broken code never builds an image |
| 3 | **Build** | Builds Docker image, tagged with both `${BUILD_NUMBER}` (traceable) and `latest` (convenience) | Stops on Dockerfile errors |
| 4 | **Push** | Authenticates with Docker Hub via Jenkins credentials, pushes both tags | Stops on auth/network failure; credentials are never logged |
| 5 | **Deploy** | Patches `k8s/deployment.yaml` with the new image tag, applies it, and waits for rollout to complete | If pods crashloop, `kubectl rollout status` fails and the pipeline is marked failed |

---

## Design decisions and trade-offs

**1. Why polling instead of webhooks?**
Jenkins runs on `localhost` for this project, so GitHub cannot reach it. Polling every 2 minutes is a pragmatic alternative. In a production deployment behind a public load balancer, webhooks are strictly better (sub-second latency, no wasted polls).

**2. Why tag images with `BUILD_NUMBER`, not just `latest`?**
`latest` is mutable — you can never roll back to a known good version. Tagging with the Jenkins build number gives every image an immutable identity. The deployment manifest is patched to the specific tag so Kubernetes also knows the exact version being deployed.

**3. Why NodePort instead of Ingress?**
NodePort is sufficient for local Minikube and keeps the demo simple. In production this would be an Ingress with TLS termination or a cloud LoadBalancer.

**4. Why no Helm chart?**
For a single application, raw YAML is more explicit and easier to reason about. Helm becomes valuable when templating across many environments or packaging the app for distribution.

**5. Where are secrets handled?**
Docker Hub credentials and GitHub PATs are stored in the Jenkins credentials store and injected as environment variables. They never appear in the repository or in build logs (Jenkins masks them automatically when declared via `withCredentials`).

---

## Security practices applied

- Docker Hub authentication uses a **Personal Access Token**, not a password — revocable and scoped
- Credentials live in Jenkins' **credentials store**, never in the Jenkinsfile or repo
- The Kubernetes Deployment defines **resource requests and limits** to prevent runaway containers from exhausting node resources
- Container image runs on **Alpine Linux** (~5MB base) to minimize attack surface
- Liveness and readiness probes ensure Kubernetes only sends traffic to healthy pods and restarts unresponsive ones automatically
- `.dockerignore` prevents source files unnecessary to the runtime (tests, docs, `.git/`) from leaking into the image

---

## Setup and run locally

### Prerequisites

- macOS (steps assume Homebrew)
- Docker Desktop
- `kubectl`, `minikube`, Node.js 18+, Git
- GitHub account + Docker Hub account

### Quick start

```bash
# 1. Clone
git clone https://github.com/SriGaneshNainala/automated-deployment-pipeline.git
cd automated-deployment-pipeline

# 2. Run the app standalone
node app.js
curl http://localhost:3000

# 3. Run the test suite
npm test

# 4. Build the container locally
docker build -t automated-deployment-pipeline:dev .
docker run --rm -p 3000:3000 automated-deployment-pipeline:dev

# 5. Start the K8s cluster and deploy manually
minikube start --driver=docker
kubectl apply -f k8s/deployment.yaml
kubectl get pods
minikube service demo-app --url
```

---

## Demonstrating the pipeline

After committing a change to `app.js`:

```bash
git commit -am "bump app version to 2.0"
git push
```

Within ~2 minutes, Jenkins:
1. Detects the new commit via SCM polling
2. Runs the test suite
3. Builds and tags `<dockerhub-user>/demo-app:<build-number>`
4. Pushes both tags to Docker Hub
5. Patches the Kubernetes deployment and waits for rollout
6. Reports the result back to the Jenkins UI

A `curl` to the service URL now returns the updated payload — no manual intervention.

---

## What I learned

- **Pipeline-as-code is non-negotiable.** A Jenkinsfile in the repo means the pipeline definition is reviewable, diffable, and survives Jenkins reinstalls.
- **Immutable image tags matter.** Using `latest` for production deploys makes rollback impossible. Build-number tags give every release a stable identity.
- **Health probes change deployment safety.** Without `readinessProbe`, Kubernetes sends traffic to a pod before the app is listening, causing transient 502s during rollout.
- **Polling vs webhooks is a network-topology decision.** Choose based on whether Jenkins is reachable from the internet.
- **Resource limits are the difference between "it works on my machine" and "it works in production."** A pod without limits can starve its neighbors.

---

## Possible extensions

- Replace polling with a GitHub webhook (requires Jenkins exposed via ngrok or a real host)
- Migrate from Docker Hub to a self-hosted Harbor registry
- Add Slack notifications on pipeline success/failure
- Promote the pipeline to multi-environment (dev → staging → prod) with K8s namespaces
- Replace raw YAML with a Helm chart parameterized per environment
- Add Trivy image scanning before pushing to the registry

---

## License

[MIT](LICENSE)
