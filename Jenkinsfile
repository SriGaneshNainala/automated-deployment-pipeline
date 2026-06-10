pipeline {
    agent any

    environment {
        IMAGE = 'nainalaganesh/demo-app'
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
                sh "docker build -t $IMAGE:${BUILD_NUMBER} -t $IMAGE:latest ."
            }
        }

        stage('Push') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-creds',
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
                withCredentials([file(credentialsId: 'minikube-kubeconfig', variable: 'KUBE_FILE')]) {
                    sh '''
                        export KUBECONFIG=$KUBE_FILE
                        sed -i "s|$IMAGE:latest|$IMAGE:$BUILD_NUMBER|" k8s/deployment.yaml
                        kubectl apply -f k8s/deployment.yaml
                        kubectl rollout status deployment/demo-app --timeout=120s
                    '''
                }
            }
        }
    }
}
