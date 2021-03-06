/**
 * @module ol/source/BingMaps
 */
import {inherits} from '../index.js';
import {createFromTileUrlFunctions} from '../tileurlfunction.js';
import {applyTransform, intersects} from '../extent.js';
import _ol_net_ from '../net.js';
import {get as getProjection, getTransformFromProjections} from '../proj.js';
import SourceState from '../source/State.js';
import _ol_source_TileImage_ from '../source/TileImage.js';
import _ol_tilecoord_ from '../tilecoord.js';
import _ol_tilegrid_ from '../tilegrid.js';

/**
 * @classdesc
 * Layer source for Bing Maps tile data.
 *
 * @constructor
 * @extends {ol.source.TileImage}
 * @param {olx.source.BingMapsOptions} options Bing Maps options.
 * @api
 */
var _ol_source_BingMaps_ = function(options) {

  /**
   * @private
   * @type {boolean}
   */
  this.hidpi_ = options.hidpi !== undefined ? options.hidpi : false;

  _ol_source_TileImage_.call(this, {
    cacheSize: options.cacheSize,
    crossOrigin: 'anonymous',
    opaque: true,
    projection: getProjection('EPSG:3857'),
    reprojectionErrorThreshold: options.reprojectionErrorThreshold,
    state: SourceState.LOADING,
    tileLoadFunction: options.tileLoadFunction,
    tilePixelRatio: this.hidpi_ ? 2 : 1,
    wrapX: options.wrapX !== undefined ? options.wrapX : true,
    transition: options.transition
  });

  /**
   * @private
   * @type {string}
   */
  this.culture_ = options.culture !== undefined ? options.culture : 'en-us';

  /**
   * @private
   * @type {number}
   */
  this.maxZoom_ = options.maxZoom !== undefined ? options.maxZoom : -1;

  /**
   * @private
   * @type {string}
   */
  this.apiKey_ = options.key;

  /**
   * @private
   * @type {string}
   */
  this.imagerySet_ = options.imagerySet;

  var url = 'https://dev.virtualearth.net/REST/v1/Imagery/Metadata/' +
      this.imagerySet_ +
      '?uriScheme=https&include=ImageryProviders&key=' + this.apiKey_ +
      '&c=' + this.culture_;

  _ol_net_.jsonp(url, this.handleImageryMetadataResponse.bind(this), undefined,
      'jsonp');

};

inherits(_ol_source_BingMaps_, _ol_source_TileImage_);


/**
 * The attribution containing a link to the Microsoft® Bing™ Maps Platform APIs’
 * Terms Of Use.
 * @const
 * @type {string}
 * @api
 */
_ol_source_BingMaps_.TOS_ATTRIBUTION = '<a class="ol-attribution-bing-tos" ' +
      'href="https://www.microsoft.com/maps/product/terms.html">' +
      'Terms of Use</a>';


/**
 * Get the api key used for this source.
 *
 * @return {string} The api key.
 * @api
 */
_ol_source_BingMaps_.prototype.getApiKey = function() {
  return this.apiKey_;
};


/**
 * Get the imagery set associated with this source.
 *
 * @return {string} The imagery set.
 * @api
 */
_ol_source_BingMaps_.prototype.getImagerySet = function() {
  return this.imagerySet_;
};


/**
 * @param {BingMapsImageryMetadataResponse} response Response.
 */
_ol_source_BingMaps_.prototype.handleImageryMetadataResponse = function(response) {
  if (response.statusCode != 200 ||
      response.statusDescription != 'OK' ||
      response.authenticationResultCode != 'ValidCredentials' ||
      response.resourceSets.length != 1 ||
      response.resourceSets[0].resources.length != 1) {
    this.setState(SourceState.ERROR);
    return;
  }

  var resource = response.resourceSets[0].resources[0];
  var maxZoom = this.maxZoom_ == -1 ? resource.zoomMax : this.maxZoom_;

  var sourceProjection = this.getProjection();
  var extent = _ol_tilegrid_.extentFromProjection(sourceProjection);
  var tileSize = resource.imageWidth == resource.imageHeight ?
    resource.imageWidth : [resource.imageWidth, resource.imageHeight];
  var tileGrid = _ol_tilegrid_.createXYZ({
    extent: extent,
    minZoom: resource.zoomMin,
    maxZoom: maxZoom,
    tileSize: tileSize / (this.hidpi_ ? 2 : 1)
  });
  this.tileGrid = tileGrid;

  var culture = this.culture_;
  var hidpi = this.hidpi_;
  this.tileUrlFunction = createFromTileUrlFunctions(
      resource.imageUrlSubdomains.map(function(subdomain) {
        var quadKeyTileCoord = [0, 0, 0];
        var imageUrl = resource.imageUrl
            .replace('{subdomain}', subdomain)
            .replace('{culture}', culture);
        return (
          /**
           * @param {ol.TileCoord} tileCoord Tile coordinate.
           * @param {number} pixelRatio Pixel ratio.
           * @param {ol.proj.Projection} projection Projection.
           * @return {string|undefined} Tile URL.
           */
          function(tileCoord, pixelRatio, projection) {
            if (!tileCoord) {
              return undefined;
            } else {
              _ol_tilecoord_.createOrUpdate(tileCoord[0], tileCoord[1],
                  -tileCoord[2] - 1, quadKeyTileCoord);
              var url = imageUrl;
              if (hidpi) {
                url += '&dpi=d1&device=mobile';
              }
              return url.replace('{quadkey}', _ol_tilecoord_.quadKey(
                  quadKeyTileCoord));
            }
          }
        );
      }));

  if (resource.imageryProviders) {
    var transform = getTransformFromProjections(
        getProjection('EPSG:4326'), this.getProjection());

    this.setAttributions(function(frameState) {
      var attributions = [];
      var zoom = frameState.viewState.zoom;
      resource.imageryProviders.map(function(imageryProvider) {
        var intersecting = false;
        var coverageAreas = imageryProvider.coverageAreas;
        for (var i = 0, ii = coverageAreas.length; i < ii; ++i) {
          var coverageArea = coverageAreas[i];
          if (zoom >= coverageArea.zoomMin && zoom <= coverageArea.zoomMax) {
            var bbox = coverageArea.bbox;
            var epsg4326Extent = [bbox[1], bbox[0], bbox[3], bbox[2]];
            var extent = applyTransform(epsg4326Extent, transform);
            if (intersects(extent, frameState.extent)) {
              intersecting = true;
              break;
            }
          }
        }
        if (intersecting) {
          attributions.push(imageryProvider.attribution);
        }
      });

      attributions.push(_ol_source_BingMaps_.TOS_ATTRIBUTION);
      return attributions;
    });
  }

  this.setState(SourceState.READY);
};
export default _ol_source_BingMaps_;
