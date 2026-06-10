pipeline {
    agent any

    parameters {
        string(name: 'IMAGE_NAME',      defaultValue: 'nainalaganesh/demo-app', description: 'Docker image name without tag')
        string(name: 'DEPLOYMENT_NAME', defaultValue: 'demo-app',               description: 'Kubernetes Deployment to roll out')
        string(name: 'NAMESPACE',       defaultValue: 'default',                description: 'Kubernetes namespace to deploy to')
        string(name: 'MANIFEST',        defaultValue: 'k8s/deployment.yaml',    description: 'Path to the Kubernetes manifest')
        string(name: 'KUBECONFIG_CRED', defaultValue: 'minikube-kubeconfig',    description: 'Jenkins credential ID for the target cluster kubeconfig')
        string(name: 'DOCKERHUB_CRED',  defaultValue: 'dockerhub-creds',        description: 'Jenkins credential ID for Docker Hub auth')
    }

    options {
        timeout(time: 15, unit: 'MINUTES')
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        IMAGE      = "${params.IMAGE_NAME}"
        DEPLOYMENT = "${params.DEPLOYMENT_NAME}"
        NS         = "${params.NAMESPACE}"
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

        stage('Deploy') {
            steps {
                withCredentials([file(credentialsId: params.KUBECONFIG_CRED, variable: 'KUBE_FILE')]) {
                    script {
                        try {
                            sh '''
                                export KUBECONFIG=$KUBE_FILE
                                sed -i "s|$IMAGE:latest|$IMAGE:$BUILD_NUMBER|" $MANIFEST
                                kubectl apply -n $NS -f $MANIFEST
                                kubectl rollout status -n $NS deployment/$DEPLOYMENT --timeout=120s
                            '''
                        } catch (err) {
                            echo "Rollout failed. Reverting to previous revision."
                            sh '''
                                export KUBECONFIG=$KUBE_FILE
                                kubectl rollout undo -n $NS deployment/$DEPLOYMENT || true
                            '''
                            error("Deploy failed: ${err.message}")
                        }
                    }
                }
            }
        }
    }

    post {
        success {
            echo "Build #${env.BUILD_NUMBER} deployed ${env.IMAGE}:${env.BUILD_NUMBER} to ${env.NS}."
        }
        failure {
            echo "Build #${env.BUILD_NUMBER} failed. Pods rolled back if a previous revision existed."
        }
        always {
            sh 'docker logout || true'
        }
    }
}
