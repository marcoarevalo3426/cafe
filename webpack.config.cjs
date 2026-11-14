const path = require('node:path');
const fs = require('node:fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const basePath=(process.env.APP_BASE_PATH??'').replace(/\/+$/,'');
if(basePath&&!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath))throw new Error('Invalid APP_BASE_PATH.');
module.exports = (_,argv) => ({
 entry:'./src/index.web.tsx', output:{path:path.resolve(__dirname,'dist'),filename:'assets/app.[contenthash].js',clean:true,publicPath:basePath+'/'},
 resolve:{extensions:['.web.tsx','.web.ts','.tsx','.ts','.web.js','.js'],alias:{'react-native$':'react-native-web'}},
 module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,loader:'esbuild-loader',options:{loader:'tsx',target:'es2022'}}]},
 plugins:[{apply(compiler){compiler.hooks.afterEmit.tap('CopyPublicAssets',()=>{for(const folder of ['design','fonts'])fs.cpSync(path.join(__dirname,'public',folder),path.join(__dirname,'dist',folder),{recursive:true});});}},new HtmlWebpackPlugin({template:'public/index.html',basePath:basePath+'/'}),new webpack.DefinePlugin({'process.env.NODE_ENV':JSON.stringify(argv.mode),'__DEV__':JSON.stringify(argv.mode!=='production'),'process.env.CAFE_STORE_ID':JSON.stringify(process.env.CAFE_STORE_ID??''),'process.env.APP_BASE_PATH':JSON.stringify(basePath)})],
 devServer:{hot:false,liveReload:true,port:8080,historyApiFallback:true,proxy:[{context:['/api','/health'],target:'http://127.0.0.1:4000'}]},
 performance:{maxEntrypointSize:800000,maxAssetSize:800000},devtool:argv.mode==='production'?'source-map':'eval-source-map'
});
