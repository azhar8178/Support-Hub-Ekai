{{/*
Expand the name of the chart.
*/}}
{{- define "ekai.name" -}}
{{- .Chart.Name }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ekai.fullname" -}}
{{- .Chart.Name }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "ekai.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
API server selector labels.
*/}}
{{- define "ekai.api.selectorLabels" -}}
app: ekai-api-server
app.kubernetes.io/name: ekai-api-server
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Portal selector labels.
*/}}
{{- define "ekai.portal.selectorLabels" -}}
app: ekai-portal
app.kubernetes.io/name: ekai-portal
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
