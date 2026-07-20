{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.npm
  ];
  env = {
    LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.libuuid ];
  };
}
