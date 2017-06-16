#!/bin/sh
RESTORE=$(echo '\033[0m')
BOLD=$(echo '\033[1m')
GREEN=$(echo '\033[1;32m')
echo
echo ${GREEN}
echo "------------------------------"
echo "   Installing imageMagick   "
echo "------------------------------"
echo
echo ${RESTORE}
apt-get update
apt-get install -y ghostscript imagemagick
convert --version