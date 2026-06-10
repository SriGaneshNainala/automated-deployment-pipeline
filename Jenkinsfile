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

        stage('Deploy') {
            steps {
                withCredentials([file(credentialsId: params.KUBECONFIG_CRED, variable: 'KUBE_FILE')]) {
                    sh '''
                        export KUBECONFIG=$KUBE_FILE
                        sed -i "s|$IMAGE:latest|$IMAGE:$BUILD_NUMBER|" $MANIFEST
                        kubectl apply -n $NS -f $MANIFEST
                        kubectl rollout status -n $NS deployment/$DEPLOYMENT --timeout=120s
                    '''
                }
            }
        }
    }
}
