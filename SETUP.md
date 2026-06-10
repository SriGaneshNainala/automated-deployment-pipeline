# Setup

End-to-end setup for both **macOS** and **Windows 10 / 11**. Linux users follow the macOS steps and substitute `apt`/`yum` for `brew`.

> **Convention used below:**
> - 🍎 = run in macOS Terminal (bash / zsh)
> - 🪟 = run in Windows PowerShell (run as Administrator only where noted)
> - 🌐 = platform-independent (e.g. anything inside `docker exec ... bash -c '…'`)

## Prerequisites

- **macOS**: Homebrew, a GitHub account, a Docker Hub account
- **Windows**: Windows 10/11 with WSL2 enabled, `winget` (built-in on modern Windows), a GitHub account, a Docker Hub account

---

## 1. Install local tools

### 🍎 macOS

```bash
brew install --cask docker
brew install kubectl minikube git
open -a Docker          # launch Docker Desktop; wait for the whale icon
```

### 🪟 Windows (PowerShell)

```powershell
winget install Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
winget install Kubernetes.kubectl    -e
winget install Kubernetes.minikube   -e
winget install Git.Git               -e

# Launch Docker Desktop from the Start menu, or:
Start-Process "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
```

Wait until Docker Desktop's icon (system tray on Windows, menu bar on macOS) shows it's **running**.

### Verify (both platforms)

```bash
docker --version
kubectl version --client
minikube version
git --version
```

---

## 2. Start the Kubernetes cluster

🌐 Identical on both platforms — the Minikube CLI is the same:

```bash
minikube start --driver=docker
kubectl get nodes     # expect: minikube  Ready  control-plane
```

---

## 3. Run Jenkins (in Docker)

The Jenkins LTS image is a Linux container, so the command's interior is the same — only the host shell quoting differs slightly.

### 🍎 macOS

```bash
docker run -d --name jenkins \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --restart unless-stopped \
  jenkins/jenkins:lts
```

### 🪟 Windows (PowerShell)

```powershell
docker run -d --name jenkins `
  -p 8080:8080 -p 50000:50000 `
  -v jenkins_home:/var/jenkins_home `
  -v /var/run/docker.sock:/var/run/docker.sock `
  --restart unless-stopped `
  jenkins/jenkins:lts
```

(PowerShell uses backtick `` ` `` for line continuation instead of backslash.)

### Get the initial admin password and open the UI

🌐 Same on both:

```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Open `http://localhost:8080` in your browser. Paste the password, choose **Install suggested plugins**, create an admin user (suggested: `admin` / `admin123` for local dev).

### Install the additional plugins this pipeline needs

In Jenkins UI: **Manage Jenkins → Plugins → Available plugins**, search and install:

- `Docker Pipeline`
- `Kubernetes CLI`
- `Blue Ocean` (optional but recommended — modern visual pipeline UI)

Restart Jenkins when prompted.

---

## 4. Install kubectl, docker CLI, and Node inside the Jenkins container

🌐 All commands run **inside** the Jenkins Linux container — identical on every host OS:

```bash
# kubectl
docker exec -u 0 jenkins bash -c 'ARCH=$(dpkg --print-architecture) && \
  curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/v1.29.0/bin/linux/$ARCH/kubectl" && \
  chmod +x /usr/local/bin/kubectl'

# docker CLI (static binary — apt's docker.io package on trixie doesn't include the binary)
docker exec -u 0 jenkins bash -c 'ARCH=$(dpkg --print-architecture | sed "s/amd64/x86_64/;s/arm64/aarch64/") && \
  curl -fsSL "https://download.docker.com/linux/static/stable/$ARCH/docker-27.3.1.tgz" | \
  tar -xz -C /tmp docker/docker && \
  mv /tmp/docker/docker /usr/local/bin/docker'

# node + npm
docker exec -u 0 jenkins bash -c 'apt-get update && apt-get install -y --no-install-recommends nodejs npm'

# allow the jenkins user to use the docker socket
docker exec -u 0 jenkins chmod 666 /var/run/docker.sock
```

> On Windows PowerShell these multi-line commands run fine as-is — PowerShell passes the single-quoted argument verbatim to `docker exec`.

---

## 5. Let Jenkins reach the Kubernetes cluster

🌐 Network connect — identical:

```bash
docker network connect minikube jenkins
docker exec jenkins getent hosts minikube     # should print an IP and `minikube`
```

### Generate a Jenkins-usable kubeconfig

The host's kubeconfig refers to the API server as `https://127.0.0.1:<port>`, which means "this container itself" when used from inside Jenkins. We point it at `https://minikube:8443` (which is in the cluster cert's SAN list) and embed all the certs inline.

#### 🍎 macOS

```bash
kubectl config view --raw --flatten > /tmp/jenkins-kubeconfig
sed -i '' 's|https://127.0.0.1:[0-9]*|https://minikube:8443|' /tmp/jenkins-kubeconfig
docker cp /tmp/jenkins-kubeconfig jenkins:/tmp/jenkins-kubeconfig
```

#### 🪟 Windows (PowerShell)

```powershell
kubectl config view --raw --flatten | Set-Content $env:TEMP\jenkins-kubeconfig
(Get-Content $env:TEMP\jenkins-kubeconfig) `
  -replace 'https://127\.0\.0\.1:[0-9]+', 'https://minikube:8443' |
  Set-Content $env:TEMP\jenkins-kubeconfig
docker cp $env:TEMP\jenkins-kubeconfig jenkins:/tmp/jenkins-kubeconfig
```

#### Verify (both platforms)

```bash
docker exec jenkins kubectl --kubeconfig=/tmp/jenkins-kubeconfig get nodes
# expect: minikube  Ready  control-plane
```

---

## 6. Add credentials in Jenkins

Open `http://localhost:8080/manage/credentials/store/system/domain/_/` and add two credentials.

### Docker Hub PAT

- **Kind**: Username with password
- **Username**: your Docker Hub username
- **Password**: a Personal Access Token (Docker Hub → Account Settings → Personal access tokens → Generate)
- **ID**: `dockerhub-creds`

> 🪟 Windows users: on the Docker Hub site, the PAT generation flow is identical. Copy the token into a temporary note — it's only shown once.

### Kubeconfig

- **Kind**: Secret file
- **File**: select `/tmp/jenkins-kubeconfig` (🍎) or `%TEMP%\jenkins-kubeconfig` (🪟)
- **ID**: `minikube-kubeconfig`

> 🪟 In the file picker, paste `%TEMP%` in the address bar to jump to your temp folder, then select `jenkins-kubeconfig`.

(Both credential IDs are the parameter defaults in the `Jenkinsfile`. If you change them, override `DOCKERHUB_CRED` and `KUBECONFIG_CRED` when triggering builds.)

---

## 7. Create the pipeline job

In Jenkins: **+ New Item** → name it `automated-deployment-pipeline` → **Pipeline** → **OK**.

In the configure page:

- **Build Triggers** → check **Poll SCM**, schedule: `H/2 * * * *`
- **Pipeline** → Definition: **Pipeline script from SCM**
  - SCM: **Git**
  - Repository URL: `https://github.com/<your-github-handle>/automated-deployment-pipeline.git`
  - Branch Specifier: `*/main`
  - Script Path: `Jenkinsfile`

Click **Save** → **Build with Parameters** (the new label, since the Jenkinsfile defines parameters) → leave the defaults → **Build**.

You can watch the run in either:
- Classic view: the **Stage View** grid on the project page
- Modern view: click **Open Blue Ocean** in the sidebar (if you installed the plugin)

---

## 8. Verify the deployment

🌐 Both platforms:

```bash
kubectl get pods -A | grep demo-app
kubectl get svc -A | grep demo-app
```

To hit the running app, open a port-forward in one terminal and curl in another.

### 🍎 macOS

```bash
# terminal 1
kubectl port-forward -n dev svc/demo-app 8081:80

# terminal 2
curl http://localhost:8081
```

### 🪟 Windows (PowerShell)

```powershell
# window 1
kubectl port-forward -n dev svc/demo-app 8081:80

# window 2
Invoke-WebRequest -Uri http://localhost:8081 -UseBasicParsing | Select-Object -ExpandProperty Content
# or, if curl.exe is available (Windows 10+ ships with it):
curl.exe http://localhost:8081
```

Expected output:
```
Hello from CI/CD pipeline! Version 2.2.0
Served by: demo-app-<pod-hash>
```

---

## Adding a new repository to this pipeline

The `Jenkinsfile` is parameterized — the same definition handles any repository.

1. Copy `Jenkinsfile` and `k8s/deployment.yaml` into the new repo.
2. In Jenkins: **+ New Item → Pipeline**, point at the new Git URL.
3. **Build with Parameters** and override:
   - `IMAGE_NAME` → e.g. `myorg/payments-api`
   - `DEPLOYMENT_NAME` → the K8s Deployment name in your manifest
   - `KUBECONFIG_CRED` / `DOCKERHUB_CRED` → existing credential IDs in Jenkins

## Adding a new Kubernetes cluster

1. Generate a kubeconfig for the new cluster:
   - EKS: `aws eks update-kubeconfig --name <cluster>`
   - GKE: `gcloud container clusters get-credentials <cluster>`
   - AKS: `az aks get-credentials --resource-group <rg> --name <cluster>`
2. In Jenkins, add the kubeconfig as a **Secret file** credential. Give it an ID like `eks-test-kubeconfig`.
3. Reference it via `KUBECONFIG_CRED` when triggering a build.

---

## Troubleshooting

| Error | Likely cause | Fix |
|---|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop not running | Launch Docker Desktop, wait for the icon to indicate "running" |
| `winget not recognized` (🪟) | Old Windows / App Installer missing | Install from Microsoft Store: search "App Installer" |
| Jenkins UI returns 503 | Plugin install still in progress | Wait ~60s, refresh |
| `kubectl: certificate signed by unknown authority` | kubeconfig server URL doesn't match the cert SAN | Re-run step 5 — the server URL must be `https://minikube:8443` |
| `permission denied while trying to connect to docker.sock` | Jenkins user can't access the socket | `docker exec -u 0 jenkins chmod 666 /var/run/docker.sock` |
| Pipeline polls but never builds | "Poll SCM" trigger not enabled | In the job config, check **Poll SCM** and add the schedule |
| `ImagePullBackOff` on pods | Image not on Docker Hub or tag mismatch | Confirm `docker push` succeeded; check the manifest's image tag |
| `provided port is already allocated` (NodePort) | Two services in different namespaces both claim a fixed nodePort | Remove the explicit `nodePort:` line; let K8s auto-assign |
| 🪟 `'sed' is not recognized` | Trying to run macOS sed in PowerShell | Use the PowerShell `Get-Content … -replace … \| Set-Content` form (see step 5) |
| 🪟 Docker volumes appear empty | WSL2 backend not enabled | Open Docker Desktop → Settings → General → check "Use the WSL2 based engine" |
