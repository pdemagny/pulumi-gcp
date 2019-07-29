First, based on https://cloud.google.com/community/tutorials/managing-gcp-projects-with-terraform

do:

- gcloud auth login
- gcloud projects create <project_id>
- gcloud config set project <project_id>
- gcloud iam service-accounts create pulumi-admin --display-name "pdemagny Pulumi Admin Account"
- gcloud projects add-iam-policy-binding <project_id> --member serviceAccount:pulumi-admin@<project_id>.iam.gserviceaccount.com --role roles/viewer
- gcloud projects add-iam-policy-binding <project_id> --member serviceAccount:pulumi-admin@<project_id>.iam.gserviceaccount.com --role roles/storage.admin
- gcloud services enable cloudresourcemanager.googleapis.com cloudbilling.googleapis.com iam.googleapis.com container.googleapis.com sqladmin.googleapis.com
- gcloud organizations add-iam-policy-binding <organization_id> --member serviceAccount:pulumi-admin@<project_id>.iam.gserviceaccount.com --role roles/resourcemanager.projectCreator
- gcloud organizations add-iam-policy-binding <organization_id> --member serviceAccount:pulumi-admin@<project_id>.iam.gserviceaccount.com --role roles/billing.user
- gcloud organizations add-iam-policy-binding <organization_id> --member serviceAccount:pulumi-admin@<project_id>.iam.gserviceaccount.com --role roles/compute.xpnAdmin
- gcloud organizations add-iam-policy-binding <organization_id> --member serviceAccount:pulumi-admin@<project_id>.iam.gserviceaccount.com --role roles/viewer
- gcloud organizations add-iam-policy-binding <organization_id> --member serviceAccount:pulumi-admin@<project_id>.iam.gserviceaccount.com --role roles/iam.serviceAccountActor
