# Setup

Everything you need to stand this up on a fresh Mac. Linux is similar — substitute `apt` for `brew` and you'll be fine.

## Prerequisites

- macOS with Homebrew
- A GitHub account
- A Docker Hub account (for image hosting)

## 1. Install local tools

```bash
brew install --cask docker
brew install kubectl minikube
brew install git
open -a Docker   # launch Docker Desktop and wait for the whale icon
```

Verify:
```bash
docker ps
kubectl version --client
minikube version
```

## 2. Start the Kubernetes cluster

```bash
minikube start --driver=docker
kubectl get nodes      # should show `minikube` Ready
```

## 3. Run Jenkins (in Docker)

```bash
docker run -d --name jenkins \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --restart unless-stopped \
  jenkins/jenkins:lts
```

Get the initial admin password and open the UI:
```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
open http://localhost:8080
```

Pick **Install suggested plugins** and create an admin user.

Then install the two extra plugins we need: **Manage Jenkins → Plugins → Available** → search and install:
- `Docker Pipeline`
- `Kubernetes CLI`

Restart Jenkins when prompted.

## 4. Install kubectl, docker CLI, and Node inside the Jenkins container

The Jenkins LTS image doesn't ship with these, but the pipeline needs them.

```bash
# kubectl
docker exec -u 0 jenkins bash -c 'ARCH=$(dpkg --print-architecture) && \
  curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/v1.29.0/bin/linux/$ARCH/kubectl" && \
  chmod +x /usr/local/bin/kubectl'

# docker CLI (static binary — apt package doesn't include the binary on trixie)
docker exec -u 0 jenkins bash -c 'ARCH=$(dpkg --print-architecture | sed "s/amd64/x86_64/;s/arm64/aarch64/") && \
  curl -fsSL "https://download.docker.com/linux/static/stable/$ARCH/docker-27.3.1.tgz" | \
  tar -xz -C /tmp docker/docker && \
  mv /tmp/docker/docker /usr/local/bin/docker'

# node + npm
docker exec -u 0 jenkins bash -c 'apt-get update && apt-get install -y --no-install-recommends nodejs npm'

# let the jenkins user talk to the docker socket
docker exec -u 0 jenkins chmod 666 /var/run/docker.sock
```

## 5. Let Jenkins reach the Kubernetes cluster

Minikube's API runs inside a Docker container on its own network. Jenkins needs to join that network so it can reach the API via the hostname `minikube` (which is in the cluster cert's SAN list):

```bash
docker network connect minikube jenkins
docker exec jenkins getent hosts minikube      # should print an IP
```

Then generate a kubeconfig that points at `https://minikube:8443` and copy it into the container:

```bash
kubectl config view --raw --flatten > /tmp/jenkins-kubeconfig
sed -i '' 's|https://127.0.0.1:[0-9]*|https://minikube:8443|' /tmp/jenkins-kubeconfig
docker cp /tmp/jenkins-kubeconfig jenkins:/tmp/jenkins-kubeconfig

# verify it works
docker exec jenkins kubectl --kubeconfig=/tmp/jenkins-kubeconfig get nodes
```

## 6. Add credentials in Jenkins

Open `http://localhost:8080/manage/credentials/store/system/domain/_/` and add two credentials:

### Docker Hub PAT
- **Kind**: Username with password
- **Username**: your Docker Hub username
- **Password**: a Personal Access Token (Docker Hub → Account Settings → Personal access tokens → Generate)
- **ID**: `dockerhub-creds`

### Kubeconfig
- **Kind**: Secret file
- **File**: select `/tmp/jenkins-kubeconfig`
- **ID**: `minikube-kubeconfig`

(Both IDs are referenced by the `Jenkinsfile`'s parameter defaults. If you change them, override `DOCKERHUB_CRED` and `KUBECONFIG_CRED` when triggering the build.)

## 7. Create the pipeline job

**New Item** → name it `automated-deployment-pipeline` → **Pipeline** → OK.

In the job config:

- **Build Triggers** → check **Poll SCM** with schedule `H/2 * * * *`
- **Pipeline** → Definition: **Pipeline script from SCM**
  - SCM: Git
  - Repository URL: `https://github.com/<you>/automated-deployment-pipeline.git`
  - Branch Specifier: `*/main`
  - Script Path: `Jenkinsfile`

Save → **Build Now**.

## Adding a new repo to this pipeline

The Jenkinsfile is parameterized, so the same pipeline definition works for any repo. To onboard a new one:

1. Push a `Jenkinsfile` (copy this repo's) and a `k8s/deployment.yaml` to the new repo.
2. In Jenkins: **New Item** → Pipeline → point it at the new Git URL.
3. Trigger a build with **Build with Parameters** and override:
   - `IMAGE_NAME` → your image name (e.g. `myorg/payments-api`)
   - `DEPLOYMENT_NAME` → your Deployment name in the K8s manifest
   - `NAMESPACE` → target namespace
   - `DOCKERHUB_CRED` and `KUBECONFIG_CRED` → existing credential IDs in Jenkins

## Adding a new Kubernetes cluster

The pipeline targets a cluster by referencing a kubeconfig credential, so you can have many.

1. Generate a kubeconfig for the new cluster (e.g. for EKS: `aws eks update-kubeconfig --name <cluster>`).
2. In Jenkins, add it as a **Secret file** credential. Give it an ID like `eks-staging-kubeconfig`.
3. When triggering a build, override `KUBECONFIG_CRED` to the new ID.

## Troubleshooting

| Error | Likely cause | Fix |
|---|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop not running | `open -a Docker`, wait for whale icon |
| Jenkins UI returns 503 | Plugin install still in progress | wait ~60s, refresh |
| `kubectl: certificate signed by unknown authority` | kubeconfig server URL doesn't match the cert SAN | re-run step 5 to regenerate with `https://minikube:8443` |
| `permission denied while trying to connect to docker.sock` | Jenkins user can't read the socket | `docker exec -u 0 jenkins chmod 666 /var/run/docker.sock` |
| Pipeline polls but never builds | Poll SCM checkbox wasn't checked | edit job config, enable Poll SCM |
| `ImagePullBackOff` on the K8s pods | Image isn't on Docker Hub yet, or tag mismatch | check `docker push` succeeded, check the manifest's image tag |
