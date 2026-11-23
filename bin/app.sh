#!/usr/bin/env bash
# Startet die lokale Trainings-Cockpit Web-App
cd "$(dirname "$0")/../app"
exec npm run dev
