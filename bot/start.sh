#!/bin/sh
echo "Bot container starting..."
echo "Node version: $(node --version)"
echo "Working dir: $(pwd)"
echo "Files: $(ls -la)"
echo "Starting bot..."
exec node --import tsx bot.ts
