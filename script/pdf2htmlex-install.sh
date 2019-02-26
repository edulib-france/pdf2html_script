#!/bin/sh
RESTORE=$(echo '\033[0m')
BOLD=$(echo '\033[1m')
GREEN=$(echo '\033[1;32m')
echo
echo ${GREEN}
echo "------------------------------"
echo "   Installing prerequisites   "
echo "------------------------------"
echo
echo ${RESTORE}
sudo apt-get update
sudo apt-get install -y build-essential checkinstall git cmake wget
sudo apt-get install -y poppler-data autotools-dev libjpeg-dev libtiff4-dev libpng12-dev libgif-dev libxt-dev autoconf automake libtool bzip2 libxml2-dev libuninameslist-dev libspiro-dev python-dev libpango1.0-dev libcairo2-dev chrpath uuid-dev uthash-dev libopenjpeg-dev libltdl-dev
mkdir src
cd src/
echo ${GREEN}
echo
echo "--------------------------"
echo "   Downloading sources    "
echo "--------------------------"
echo
echo ${RESTORE}
wget https://poppler.freedesktop.org/poppler-0.54.0.tar.xz
wget http://download.savannah.gnu.org/releases/freetype/freetype-doc-2.7.tar.gz
wget https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.12.1.tar.bz2
git clone https://github.com/coolwanglu/fontforge.git
git clone https://github.com/coolwanglu/pdf2htmlEX.git
echo ${GREEN}
echo
echo "------------------------"
echo "   Installing poppler   "
echo "------------------------"
echo
echo ${RESTORE}
tar xf poppler-0.54.0.tar.xz
cd poppler-0.54.0
./configure --prefix=/usr --enable-xpdf-headers && make && sudo make install
cd ..
echo ${GREEN}
echo
echo "-------------------------"
echo "   Installing freetype   "
echo "-------------------------"
echo
echo ${RESTORE}
tar zvxf freetype-doc-2.7.tar.gz
cd freetype-2.7
./configure && make && sudo make install
cd ..
echo ${GREEN}
echo
echo "---------------------------"
echo "   Installing fontconfig   "
echo "---------------------------"
echo
echo ${RESTORE}
tar jxvf fontconfig-2.12.1.tar.bz2
cd fontconfig-2.12.1
./configure && make && sudo make install
cd ..
echo ${GREEN}
echo
echo "-------------------------------------------"
echo "            Installing fontforge           "
echo 
echo "   This will take a while, grab a coffee   "
echo "-------------------------------------------"
echo
echo ${RESTORE}
cd fontforge
git checkout pdf2htmlEX
./autogen.sh
./configure --prefix=/usr && make && sudo make install
cd ..
echo ${GREEN}
echo
echo "---------------------------"
echo "   Installing pdf2htmlEX   "
echo "---------------------------"
echo
echo ${RESTORE}
cd pdf2htmlEX
cmake . && make && sudo make install
echo ${GREEN}
echo
echo "------------------------------------------------"
echo "                  FINISHED!                     "
echo "------------------------------------------------"
echo
echo ${RESTORE}
echo ${BOLD}
pdf2htmlEX --version
echo ${RESTORE}
