{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.nodePackages.pnpm
    pkgs.python311
    pkgs.python311Packages.pip
    pkgs.python311Packages.virtualenv
    pkgs.pkg-config
    pkgs.openssl
    pkgs.postgresql
    pkgs.libiconv
    pkgs.gcc
    pkgs.gnumake
    pkgs.bash
  ];
}
