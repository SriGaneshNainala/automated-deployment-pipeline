pipeline {
    agent any

    parameters {
        string(name: 'IMAGE_NAME',      defaultValue: 'nainalaganesh/demo-app', description: 'Docker image name without tag')
        string(name: 'DEPLOYMENT_NAME', defaultValue: 'demo-app',               description: 'Kubernetes Deployment to roll out')
        string(name: 'MANIFEST',        defaultValue: 'k8s/deployment.yaml',    description: 'Path to the Kubernetes manifest')
        string(name: 'KUBECONFIG_CRED', defaultValue: 'minikube-kubeconfig',    description: 'Jenkins credential ID for the target cluster kubeconfig')
        string(name: 'DOCKERHUB_CRED',  defaultValue: 'dockerhub-creds',        description: 'Jenkins credential ID for Docker Hub auth')
    }

    options {
        timeout(time: 60, unit: 'MINUTES')
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        IMAGE      = "${params.IMAGE_NAME}"
        DEPLOYMENT = "${params.DEPLOYMENT_NAME}"
        MANIFEST   = "${params.MANIFEST}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Build') {
            steps {
                sh 'docker build -t $IMAGE:$BUILD_NUMBER -t $IMAGE:latest .'
            }
        }

        stage('Push') {
            steps {
                retry(2) {
                    withCredentials([usernamePassword(
                        credentialsId: params.DOCKERHUB_CRED,
                        usernameVariable: 'DH_USER',
                        passwordVariable: 'DH_PASS'
                    )]) {
                        sh '''
                            echo "$DH_PASS" | docker login -u "$DH_USER" --password-stdin
                            docker push $IMAGE:$BUILD_NUMBER
                            docker push $IMAGE:latest
                            docker logout
                        '''
                    }
                }
            }
        }

        stage('Prepare manifest') {
            steps {
                sh 'sed -i "s|$IMAGE:latest|$IMAGE:$BUILD_NUMBER|" $MANIFEST'
            }
        }

        stage('Deploy to dev') {
            steps {
                script { deployToNamespace('dev') }
            }
        }

        stage('Promote to test?') {
            steps {
                timeout(time: 30, unit: 'MINUTES') {
                    input message: "Promote build #${env.BUILD_NUMBER} to test?", ok: 'Promote'
                }
            }
        }

        stage('Deploy to test') {
            steps {
                script { deployToNamespace('test') }
            }
        }

        stage('Promote to prod?') {
            steps {
                timeout(time: 30, unit: 'MINUTES') {
                    input message: "Promote build #${env.BUILD_NUMBER} to prod?", ok: 'Promote'
                }
            }
        }

        stage('Deploy to prod') {
            steps {
                script { deployToNamespace('prod') }
            }
        }
    }

    post {
        success  { echo "Build #${env.BUILD_NUMBER} reached prod with ${env.IMAGE}:${env.BUILD_NUMBER}." }
        failure  { echo "Build #${env.BUILD_NUMBER} failed. Any successful deploys remain in place." }
        aborted  { echo "Build #${env.BUILD_NUMBER} stopped at an approval gate. Already-deployed environments are unchanged." }
        always   { sh 'docker logout || true' }
    }
}

def deployToNamespace(String ns) {
    withCredentials([file(credentialsId: params.KUBECONFIG_CRED, variable: 'KUBE_FILE')]) {
        try {
            sh """
                export KUBECONFIG=\$KUBE_FILE
                kubectl create namespace ${ns} --dry-run=client -o yaml | kubectl apply -f -
                kubectl apply -n ${ns} -f \$MANIFEST
                kubectl rollout status -n ${ns} deployment/\$DEPLOYMENT --timeout=120s
            """
        } catch (err) {
            echo "Rollout failed in ${ns}. Reverting to previous revision."
            sh """
                export KUBECONFIG=\$KUBE_FILE
                kubectl rollout undo -n ${ns} deployment/\$DEPLOYMENT || true
            """
            error("Deploy to ${ns} failed: ${err.message}")
        }
    }
}
