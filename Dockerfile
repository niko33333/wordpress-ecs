# ARG IMAGE
# FROM $IMAGE

#Download base image ubuntu 16.04
FROM ubuntu:20.04

RUN apt update && apt upgrade -y && DEBIAN_FRONTEND=noninteractive apt install -y tzdata apache2 wordpress libapache2-mod-php php php-cli php-fpm php-json php-common php-mysql php-zip php-gd php-mbstring php-curl php-xml php-pear php-bcmath php-bz2 php-pgsql php-dba php-soap php-redis

RUN a2enmod rewrite

RUN chown -R www-data:www-data /var/www/html/

EXPOSE 80

CMD apachectl -D FOREGROUND