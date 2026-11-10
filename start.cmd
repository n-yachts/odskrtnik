@echo off
rem Spusti Odskrtnik na http://localhost:8082 a otevre ho v prohlizeci.
title Odskrtnik
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*
