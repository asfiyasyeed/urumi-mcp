{{- define "store.url" -}}
{{ .Values.scheme }}://{{ .Values.host }}{{ if .Values.publicPort }}:{{ .Values.publicPort }}{{ end }}
{{- end -}}
