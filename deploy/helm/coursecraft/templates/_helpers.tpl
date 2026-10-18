{{/* SPDX-License-Identifier: Apache-2.0 */}}
{{- define "coursecraft.name" -}}coursecraft{{- end -}}

{{- define "coursecraft.fullname" -}}
{{- printf "%s" .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}

{{- define "coursecraft.labels" -}}
app.kubernetes.io/name: {{ include "coursecraft.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "coursecraft.selector" -}}
app.kubernetes.io/name: {{ include "coursecraft.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "coursecraft.secretName" -}}
{{- default (printf "%s-secrets" (include "coursecraft.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{/* Connection URL of one role; the password comes from the Secret at runtime. */}}
{{- define "coursecraft.dbUrl" -}}
{{- $role := index . 0 -}}
{{- $key := index . 1 -}}
{{- $root := index . 2 -}}
{{- printf "postgres://%s:$(%s)@%s:%v/%s?sslmode=%s" $role $key $root.Values.database.host $root.Values.database.port $root.Values.database.name $root.Values.database.sslmode -}}
{{- end -}}

{{/* Environment shared by every pod that touches files. */}}
{{- define "coursecraft.storageEnv" -}}
{{- if eq .Values.storage.kind "s3" }}
- name: COURSECRAFT_STORAGE
  value: s3
- name: COURSECRAFT_S3_ENDPOINT
  value: {{ required "storage.s3.endpoint is required" .Values.storage.s3.endpoint | quote }}
- name: COURSECRAFT_S3_REGION
  value: {{ .Values.storage.s3.region | quote }}
- name: COURSECRAFT_S3_BUCKET
  value: {{ required "storage.s3.bucket is required" .Values.storage.s3.bucket | quote }}
- name: COURSECRAFT_S3_KEY_PREFIX
  value: {{ .Values.storage.s3.keyPrefix | quote }}
- name: COURSECRAFT_S3_VIRTUAL_HOSTED_STYLE
  value: {{ .Values.storage.s3.virtualHostedStyle | quote }}
{{- end }}
{{- end -}}

{{- define "coursecraft.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
{{- end -}}

{{- define "coursecraft.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
{{- end -}}
