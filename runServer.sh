#!/bin/bash


# if the $NODE variable is not set, set it before sourcing emsdk
if [ -z "$NODE" ]; then
NODE=$(which node)
fi

cd ..

#Run the server
sleep 5
pwd
cd emsdk
source emsdk_env.sh
cd ../simulator

# run the node server on the correct version
LIBWALLABY_ROOT=../libwallaby $NODE express.js

