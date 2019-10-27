#!/bin/sh

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[1;34m'
YELLOW='\033[1;33m'
DARK='\033[1;30m'
NC='\033[0m'

unameOut="$(uname -s)"
ROOT_DIR=$(dirname $(cd "$(dirname "$0")";pwd))
TARGET_DIR=${ROOT_DIR}"/bin"

case "${unameOut}" in
    Darwin*)    arch=macos
    			bin_dir="/usr/local/bin"
    			;;
    *)          arch=amd64
    			bin_dir="${HOME}/bin"
    			;;
esac

echo "Directory:     [${bin_dir}]"

test ! -d ${bin_dir} && mkdir ${bin_dir}
cp ${TARGET_DIR}/zpan ${bin_dir}
cp ${ROOT_DIR}/developments/config.yaml.tpl /etc/zpan/config.yaml

if [ $? -eq 0 ]
then
  echo "${GREEN}"
  echo "Installation completed successfully."
  echo "$ zpan --version"
  ${bin_dir}/zpan --version
else
  echo "${RED}"
  echo "Failed installing zpan"
fi

echo "${NC}"