
import React, { PureComponent } from 'react';

import {
  ActivityIndicator,
  Alert,
  Linking,
  Text,
  View,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

import t from 'tcomb-form-native';
import sha1 from 'sha1';
import Modal from 'react-native-simple-modal';
import storage from 'react-native-storage-wrapper';
import Swipeout from 'react-native-swipeout';
import Prompt from 'react-native-input-prompt';
import Icon from 'react-native-vector-icons/FontAwesome';
import SafariView from 'react-native-safari-view';
import jwt_decode from 'jwt-decode';
import SmLoginPage from '../SmLoginPage';
import { Dropbox } from 'dropbox';
import { deepCopy, ingeojson } from 'ourvoiceusa-sdk-js';
import { Divider, api_base_uri, DINFO, _loginPing, _saveUser, _getApiToken, _fileReaderAsync } from '../../common';
import DeviceInfo from 'react-native-device-info';
import { RNCamera } from 'react-native-camera';
import { wsbase } from '../../config';

import RBush from 'rbush';
import rtree from '../../../rtree.json';
import { geographies } from '../../geographies';

import OVComponent from '../OVComponent';

var Form = t.form.Form;

export default class App extends OVComponent {

  constructor(props) {
    super(props);

    this.state = {
      refer: props.refer,
      loading: true,
      user: null,
      forms: [],
      dbx: null,
      dbxformfound: false,
      SelectModeScreen: false,
      SmLoginScreen: false,
      server: null,
      serverLoading: false,
      myPosition: {latitude: null, longitude: null},
      showCamera: false,
      inviteUrl: props.refer.state.inviteUrl,
    };

    this.onChange = this.onChange.bind(this);

    this.formServerItems = t.struct({
      server: t.String,
      ack: t.subtype(t.Boolean, function (s) { return s }), // boolean that fails validation if not selected
    });

    this.formServerOptions = {
      fields: {
        server: {
          label: 'Server Domain Name',
          help: 'Enter the domain name of the server you wish to connect to.',
          error: 'You must enter a domain name.',
          autoCapitalize: 'none',
          autoCorrect: false,
          autoFocus: true,
          keyboardType: 'email-address',
        },
        ack: {
          label: 'Terms of Use',
          help: 'By checking this you acknowledge that the server to which you are connecting is not affiliated with Our Voice USA and the data you send and receive is governed by that server\'s terms of use.',
          error: 'You must acknowledge the terms of use.',
        },
      },
    };
  }

  onChange(server) {
    this.setState({server});
  }

  checkLocationAccess() {
    const { myPosition } = this.state;
    if (!this.state.locationAccess) {
      Alert.alert('Location Access', 'Your device settings deny this app access to your location, please enable location access for this app in your device settings to continue.', [{text: 'OK'}], { cancelable: false });
      return false;
    }
    if (!myPosition.longitude || !myPosition.latitude) {
      Alert.alert('Location Services', 'Location Services is unavailable, please turn on Location Seervices in your device settings and restart this app to continue.');
      return false;
    }
    return true;
  }

  navigate_canvassing(args) {
    const { navigate } = this.props.navigation;

    if (!this.checkLocationAccess()) return;

    navigate('Canvassing', args);
  }

  connectToGOTV = async() => {
    const { myPosition, orgId, inviteCode } = this.state;

    if (!this.checkLocationAccess()) return;

    let state;

    new RBush(9).fromJSON(rtree).search({
      minX: myPosition.longitude,
      minY: myPosition.latitude,
      maxX: myPosition.longitude,
      maxY: myPosition.latitude,
    }).forEach(bb => {
      let geo = geographies[bb.state];
      if (geo.geography) geo = geo.geography;
      if (ingeojson(geo, myPosition.longitude, myPosition.latitude))
        state = bb.state;
    });

    if (!state) return setTimeout(() => Alert.alert('Out of bounds', 'You are not located within the United States of America. Unable to continue.', [{text: 'OK'}], { cancelable: false }), 500);

    if (orgId && orgId.match(/^[0-9A-Z]*$/)) {
      // first two characters are the state code
      let place = this.state.orgId.substring(0,2).toLowerCase();

      this.connectToServer('gotv-'+place+'.ourvoiceusa.org', orgId, inviteCode);
    } else {
      setTimeout(() => Alert.alert('Error', 'You must enter a valid QR Code or Organization ID to continue.', [{text: 'OK'}], { cancelable: false }), 500);
    }
  }

  connectToServer = async(server, orgId, inviteCode) => {
    if (!this.checkLocationAccess()) return;

    this.setState({serverLoading: true, server});

    let ret = await this.singHello(server, orgId, inviteCode);

    if (ret.flag !== true) Alert.alert((ret.error?'Error':'Connection Successful'), ret.msg, [{text: 'OK'}], { cancelable: false });
    if (ret.error !== true) server = null;

    this.setState({serverLoading: false});
  }

  sayHello = async (server, orgId, inviteCode) => {
    const { myPosition } = this.state;

    if (!this.checkLocationAccess()) return;

    // mock a fetch object
    let res = {headers: {get: () => wsbase+'/auth'}, status: 404};
    try {
      let jwt = await storage.get('OV_JWT');

      try {
        // if the jwt doesn't have an id, discard it
        let obj = jwt_decode(jwt);
        if (!obj.id) throw "not a full user object";
      } catch (e) {
        await storage.del('OV_JWT');
      }

      let https = true;
      if (server.match(/:8080/)) https = false;

      res = await fetch('http'+(https?'s':'')+'://'+server+api_base_uri(orgId)+'/hello', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer '+(jwt?jwt:"of the one ring"),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          longitude: myPosition.longitude,
          latitude: myPosition.latitude,
          dinfo: DINFO,
          inviteCode,
        }),
      });
      if (res.status === 400 || res.status === 401) await storage.del('OV_JWT');
    } catch (e) {
      if (orgId) res = {headers: {get: () => ''}, status: 404};
      console.warn("sayHello error: "+e);
    }
    return res;
  }

  singHello = async (server, orgId, inviteCode) => {
    const { navigate } = this.props.navigation;
    let ret;

    try {
      let res = await this.sayHello(server, orgId, inviteCode);
      let auth_location = res.headers.get('x-sm-oauth-url');

      if (!auth_location || !auth_location.match(/^https:.*auth$/)) {
        // Invalid x-sm-oauth-url header means it's not a validy configured canvass-broker
        if (orgId) return {error: true, msg: "Sorry, that is not a valid QR Code or Organization ID."}
        return {error: true, msg: "That server is not running software compatible with this mobile app."};
      }

      if (auth_location !== wsbase+'/auth') {
        return {error: true, msg: "Custom authentication not yet supported."};
      }

      switch (res.status) {
        case 200:
          // valid - break to proceed
          break;
        case 400:
          return {error: true, msg: "The server didn't understand the request sent from this device."};
        case 401:
          setTimeout(() => this.setState({SmLoginScreen: true}), 500);
          return {error: false, flag: true};
        case 403:
          return {error: true, msg: "We're sorry, but your request to canvass with this server has been rejected."};
        default:
          return {error: true, msg: "There was a problem connecting, please try again later."};
      }

      let body = await res.json();

      if (body.data.ready !== true) return {error: false, msg: (body.msg?body.msg:"Awaiting assignment.")};
      else {
        let forms = this.state.forms;
        let forms_server = [];
        let forms_local;

        this.setState({loading: true});

        try {
          forms_local = JSON.parse(await storage.get('OV_CANVASS_FORMS'));
          if (forms_local === null) forms_local = [];
        } catch (e) {
          console.warn("_loadForms 1: "+e);
          return;
        }

        let jwt = await storage.get('OV_JWT');
        for (let i = 0; i < body.data.forms.length; i++) {
          let https = true;
          if (server.match(/:8080/)) https = false;

          res = await fetch('http'+(https?'s':'')+'://'+server+api_base_uri(orgId)+'/form/get?formId='+body.data.forms[i].id, {
            headers: {
              'Authorization': 'Bearer '+(jwt?jwt:"of the one ring"),
              'Content-Type': 'application/json',
            },
          });

          // don't store a form error
          if (res.status !== 200) continue;

          let form = await res.json();
          form.server = server;
          form.backend = 'server';
          form.orgId = orgId,

          forms_server.push(form);

          // prevent duplicates
          if (forms_local.map(f => (f?f.id:null)).indexOf(form.id) === -1) forms_local.push(form);
        }

        try {
          await storage.set('OV_CANVASS_FORMS', JSON.stringify(forms_local));
        } catch (error) {
        }

        this.setState({forms, loading: false});

        // if there's more than one form in body.data.forms, don't navigate
        if (forms_server.length === 1) {
          this.navigate_canvassing({server, orgId, form: forms_server[0], user: this.state.user, refer: this});
        }
        await this._loadForms();
        return {error: false, flag: true};
      }
    } catch (e) {
      console.warn("singHello: "+e);
      return {error: true, msg: "There was an unexpected error, please try again later."};
    }

  }

  componentDidMount() {
    // Add event listener to handle OAuthLogin:// URLs
    Linking.addEventListener('url', this.handleOpenURL);
    // Launched from an external URL
    Linking.getInitialURL().then((url) => {
      if (url) this.handleOpenURL({ url });
    });
    this._loadForms();
  }

  componentWillUnmount() {
    // Remove event listener
    Linking.removeEventListener('url', this.handleOpenURL);
  };

  componentDidUpdate(prevProps, prevState) {
    const { SmLoginScreen, server, user, orgId, inviteCode } = this.state;
    if (prevState.SmLoginScreen && !SmLoginScreen && user.loggedin) {
      this.connectToServer(server, orgId, inviteCode);
    }
  }

  handleOpenURL = async ({ url }) => {
    try {
      // Extract jwt token out of the URL
      const m = url.match(/dropbox=([^#]+)/);
      if (m) {
        let user = await _loginPing(this, false);
        user.dropbox = jwt_decode(m[1]);
        await _saveUser(user, false);
      }

      // TODO: handle the navigate that would have been tapped had we already been logged in
    } catch(e) {
      console.warn("handleOpenURL: "+e);
    }

    if (Platform.OS === 'ios') {
      SafariView.dismiss();
    }

    this._loadForms();
  }

  // Open URL in a browser
  openURL = (url) => {
    // Use SafariView on iOS
    if (Platform.OS === 'ios') {
      SafariView.show({
        url: url,
        fromBottom: true,
      });
    }
    // Or Linking.openURL on Android
    else {
      Linking.openURL(url);
    }
  };

  _loadForms = async () => {
    const { navigate } = this.props.navigation;
    const { refer, inviteUrl } = this.state;

    let folders = [];
    let forms_local = [];
    let dbxformfound = false;

    this.setState({loading: true});

    await this.requestLocationPermission();
    if (inviteUrl) {
      setTimeout(() => {
        this.setState({inviteUrl: null}, () => {
          this.parseInvite(inviteUrl);
          refer.setState({inviteUrl: null});
        });
      }, 500);
    }

    try {
      forms_local = JSON.parse(await storage.get('OV_CANVASS_FORMS'));
      if (forms_local === null) forms_local = [];
    } catch (e) {
      console.warn("_loadForms 1: "+e);
      return;
    }

    let user;
    let dbx;
    let forms = [];

    // look for canvassing forms
    try {
      user = await _loginPing(this, false);
      dbx = new Dropbox({ fetch: fetch, accessToken: user.dropbox.accessToken });
      let res = await dbx.filesListFolder({path: ''});
      for (let i in res.entries) {
        item = res.entries[i];
        if (item['.tag'] != 'folder') continue;
        folders.push(item.path_display);
      }
      this.setState({connected: true});
    } catch (e) {
    }

    let pro = [];

    for (let i in folders) {
      pro.push(dbx.filesDownload({ path: folders[i]+'/canvassingform.json' }));
    }

    let objs = await Promise.all(pro.map(p => p.catch(e => e)));
    for (let i in objs) {
      try {
        item = objs[i];
        if (item.error) continue;
        let json = JSON.parse(await _fileReaderAsync(item.fileBlob));
        json.backend = "dropbox";
        json.folder_path = item.path_display.match('.*/')[0].slice(0, -1);

        for (let idx in forms_local) {
          if (forms_local[idx] === null || forms_local[idx].id === json.id) delete forms_local[idx];
        }

        forms_local.push(json);
      } catch(e) {
        console.warn("_loadForms 2: "+e);
      }
    }

    for (let i in forms_local) {
      let json = forms_local[i];
      if (json === null) continue;

      let icon = "mobile";
      let color = "black";
      let size = 30;

      if (json.backend === "dropbox") {
        icon = "dropbox";
        color = "#3d9ae8";
        size = 25;
        dbxformfound = true;
      }

      if (json.backend === "server") {
        icon = "cloud-upload";
        size = 25;

        // atempt to re-pull the form to see if it's changed
        try {
          let jwt = await storage.get('OV_JWT');
          let https = true;
          if (json.server.match(/:8080/)) https = false;
          let res = await fetch('http'+(https?'s':'')+'://'+json.server+api_base_uri(json.orgId)+'/form/get?formId='+json.id, {
            headers: {
              'Authorization': 'Bearer '+(jwt?jwt:"of the one ring"),
              'Content-Type': 'application/json',
            },
          });

          // don't store a form error
          if (res.status === 200) {
            let server = json.server;
            let orgId = json.orgId;
            json = await res.json();
            json.server = server;
            json.backend = 'server';
            json.orgId = orgId;
            
            forms_local[i] = json;
          }

          // user cannot see this form
          if (res.status === 403) {
            json = {deleted:true};
            forms_local[i] = json;
          }
        } catch (e) {
          console.warn(""+e);
        }
      }

      let swipeoutBtns = [
        {
          text: 'Edit',
          type: 'primary',
          onPress: () => {
            if (json.backend === "dropbox" && !user.dropbox) {
              this.openURL(wsbase+'/auth/dm');
              return;
            }
            navigate('CreateSurvey', {title: 'Edit Form', dbx: dbx, form: json, refer: this});
          },
        },
        {
          text: 'Delete',
          type: 'delete',
          onPress: () => {
            Alert.alert(
              'Delete Form',
              'Are you sure you wish to delete this form? All related canvassing data will be lost.',
              [
                {text: 'Yes', onPress: async () => {
                  try {
                    if (json.backend === "dropbox") {
                      await dbx.filesDeleteV2({path: json.folder_path});
                    }
                    delete forms_local[i];
                    await storage.del('OV_CANVASS_PINS@'+json.id);
                    await storage.set('OV_CANVASS_FORMS', JSON.stringify(forms_local));
                    Alert.alert(
                      'Delete Success',
                      'You have deleted the form: '+json.name,
                      [{text: 'OK'}],
                      { cancelable: false }
                    );
                    this._loadForms();
                  } catch (e) {
                    Alert.alert(
                      'Delete Failed',
                      'There was an error deleting the form: '+json.name,
                      [{text: 'OK'}],
                      { cancelable: false }
                    );
                    console.warn("_loadForms 3: "+e);
                  }
                }},
                {text: 'No'},
              ], { cancelable: false }
            );
          },
        },
      ];

      if (user.dropbox && json.backend === "dropbox")
        if (this.state.connected !== true || user.dropbox.account_id !== json.author_id)
          swipeoutBtns.shift();

      let createdby = 'Created by '+json.author;

      if (json.backend === 'server') {
        if (json.orgId) createdby = 'Organization ID '+json.orgId;
        else createdby = 'Hosted by '+json.server;
        swipeoutBtns.shift();
      }

      if (!json.deleted) {
        forms.push(
        <View key={i} style={{margin: 5, flexDirection: 'row'}}>
          <Swipeout
            style={{backgroundColor: '#d7d7d7', flex: 1, padding: 10, borderRadius: 20, maxWidth: 350}}
            right={swipeoutBtns}
            autoClose={true}>
            <TouchableOpacity
              onPress={async () => {
                if (json.backend === "dropbox" && !user.dropbox) {
                  this.setState({SelectModeScreen: true});
                } else {
                  if (json.backend === "server") {
                    // TODO: set loading state as this can take a few seconds
                    let ret = await this.sayHello(json.server, json.orgId);
                    if (ret.status === 200) this.navigate_canvassing({server: json.server, orgId: json.orgId, form: json, user: user, refer: this});
                    else setTimeout(() => this.setState({SmLoginScreen: true}), 500);
                 } else {
                    navigate('LegacyCanvassing', {dbx: (json.backend === "dropbox" ? dbx : null), form: json, user: user});
                  }
                }
              }}>
              <View style={{flexDirection: 'row'}}>
                <Icon style={{margin: 5, marginRight: 10}} name={icon} size={size} color={color} />
                <View>
                  <Text style={{fontWeight: 'bold'}}>{json.name}</Text>
                  <Text style={{fontSize: 12}}>{createdby}</Text>
                </View>
              </View>
            </TouchableOpacity>
          </Swipeout>
        </View>
        );
      }
    }

    // cache forms locally
    try {
      forms_local = forms_local.filter((f) => {
        // don't store non-objects
        if (f === null || typeof f !== "object") return false;
        // don't store deleted forms
        return !f.deleted;
      });
      await storage.set('OV_CANVASS_FORMS', JSON.stringify(forms_local));
    } catch (error) {
    }

    this.setState({dbxformfound, dbx, forms, loading: false, SelectModeScreen: (forms.length === 0)});
  }

  _canvassGuidelinesUrlHandler() {
    const url = "https://github.com/OurVoiceUSA/HelloVoter/blob/master/docs/Canvassing-Guidelines.md";
    return Linking.openURL(url).catch(() => null);
  }

  _canvassUrlHandler() {
    const url = "https://github.com/OurVoiceUSA/HelloVoter/blob/master/docs/Canvassing.md";
    return Linking.openURL(url).catch(() => null);
  }

  dropboxLogout = async () => {
    let { user } = this.state;
    if (user.dropbox)
      new Dropbox({ fetch: fetch, accessToken: user.dropbox.accessToken }).authTokenRevoke();
    delete user.dropbox;
    _saveUser(user, false);
    try {
      forms_local = JSON.parse(await storage.get('OV_CANVASS_FORMS'));
      if (forms_local !== null) {
        for (let idx in forms_local) {
          if (forms_local[idx] === null || forms_local[idx].backend === "dropbox") delete forms_local[idx];
        }
        await storage.set('OV_CANVASS_FORMS', JSON.stringify(forms_local));
      }
    } catch (e) {
      console.warn("dropboxLogout: "+e)
    }
    this.props.navigation.goBack();
  }

  parseInvite(url) {
    let obj = {};

    this.setState({showCamera: false, SelectModeScreen: false, askOrgId: false});

    try {
      // Why oh why is the "new URL()" object not implemented in RN?!? gah
      // brings me back to my perl days with ugly one liners. Ahh, the nostalgia! convert URI key/values to object
      url.split('?')[1].split('&').forEach(p => {
        const [p1,p2] = p.split('=');
        obj[p1] = p2;
      });

      // orgId means GOTV
      if (obj.orgId) this.setState({orgId: obj.orgId, inviteCode: obj.inviteCode}, () => this.connectToGOTV());
      else this.connectToServer(obj.server, null, obj.inviteCode);
    } catch (e) {
      console.warn(""+e);
    }
  }

  render() {
    const { showCamera, connected, dbx, dbxformfound, loading, user, forms } = this.state;
    const { navigate } = this.props.navigation;

    // wait for user object to become available
    if (!user) return (
        <View style={{flex: 1, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center'}}>
          <Text style={{fontSize: 20}}>Loading user data...</Text>
          <ActivityIndicator />
        </View>
      );

    if (!loading && !forms.length) {
      forms.push(
        <View key={1}>
          <Text>No Canvassing forms. Ask someone who created one to share their form with you, or create a new one.</Text>
        </View>
      );
    }

    // if camera is open, render just that
    if (showCamera) return (
      <RNCamera
        ref={ref => {this.camera = ref;}}
        style={{
          flex: 1,
          justifyContent: 'space-between',
        }}
        androidCameraPermissionOptions={{
         title: 'Permission to use camera',
          message: 'We need your permission to use your camera',
          buttonPositive: 'Ok',
          buttonNegative: 'Cancel',
        }}
        onBarCodeRead={(b) => this.parseInvite(b.data)}
        barCodeTypes={[RNCamera.Constants.BarCodeType.qr]}
      />
    );

    return (
      <ScrollView style={{flex: 1, backgroundColor: 'white'}} contentContainerStyle={{flexGrow:1}} keyboardShouldPersistTaps={"handled"}>

        <Divider />

        <View style={{flexDirection: 'row', margin: 20, marginTop: 0}}>
            {loading &&
            <View style={{flex: 1, margin: 20, alignItems: 'center'}}>
              <Text>Loading data...</Text>
              <ActivityIndicator size="large" />
            </View>
            ||
            <View style={{flex: 1, alignItems: 'center'}}>
              <Text style={{margin: 10}}>Select a canvassing campaign:</Text>
              { forms }
            </View>
            }
        </View>

        <View>
          <Divider />

          <View style={{margin: 12, alignItems: 'center'}}>
            <Icon.Button
              name="plus-circle"
              backgroundColor="#d7d7d7"
              color="black"
              onPress={() => this.setState({SelectModeScreen: true})}>
              Start a new Canvassing Activity
            </Icon.Button>
          </View>

          {user.dropbox &&
          <View style={{margin: 12, marginTop: 0, alignItems: 'center'}}>

            <Divider />

            <View style={{margin: 20, alignItems: 'center'}}>
              <Text>You are logged into Dropbox as:</Text>
              <Text>{user.dropbox.name.display_name}</Text>
            </View>

            <Icon.Button
              name="dropbox"
              backgroundColor="#3d9ae8"
              color="#ffffff"
              onPress={() => {
                Alert.alert(
                  'Dropbox Logout',
                  'Are you sure you wish to logout of Dropbox?',
                  [
                    {text: 'Yes', onPress: () => this.dropboxLogout()},
                    {text: 'No'},
                  ], { cancelable: false }
                );
              }}>
              Dropbox Logout
            </Icon.Button>
          </View>
          }

          {!user.dropbox && dbxformfound &&
          <View style={{margin: 12, marginTop: 0, alignItems: 'center'}}>
            <Icon.Button
              name="dropbox"
              backgroundColor="#3d9ae8"
              color="#ffffff"
              onPress={() => this.setState({SelectModeScreen: true})}>
              Login with Dropbox
            </Icon.Button>
          </View>
          }

        </View>

        <Divider />

        <View style={{margin: 12}}>
          <Text>
            Need help using this tool? Check out our <Text style={{fontWeight: 'bold', color: 'blue'}} onPress={() => {this._canvassUrlHandler()}}>
            canvassing documentation</Text> with useful articles and video demos.
          </Text>
        </View>

        <Divider />

        <View style={{margin: 12}}>
          <Text>
            By using this tool you acknowledge that you are acting on your own behalf, do not represent Our Voice USA
            or its affiliates, and have read our <Text style={{fontWeight: 'bold', color: 'blue'}} onPress={() => {this._canvassGuidelinesUrlHandler()}}>
            canvassing guidelines</Text>. Please be courteous to those you meet.
          </Text>
        </View>

        <Modal
          open={this.state.SelectModeScreen}
          modalStyle={{flex: 1, backgroundColor: "transparent"}}
          overlayBackground={'rgba(0, 0, 0, 0.75)'}
          animationDuration={200}
          animationTension={40}
          modalDidOpen={() => undefined}
          modalDidClose={() => this.setState({SelectModeScreen: false})}
          closeOnTouchOutside={true}
          disableOnBackPress={false}>
          <View style={{flex: 1, alignItems: 'center'}} ref="backgroundWrapper">
            <View style={{flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center'}}>
              <View style={{backgroundColor: 'white', padding: 20, borderRadius: 40, borderWidth: 10, borderColor: '#d7d7d7'}}>
                <Text style={styles.header}>
                  Select Canvassing Mode
                </Text>

                <View style={{margin: 5}}>
                  <Icon.Button
                    name="qrcode"
                    backgroundColor="#d7d7d7"
                    color="#000000"
                    onPress={() => this.setState({showCamera: true})}
                    {...iconStyles}>
                    Scan QR Code
                  </Icon.Button>
                </View>

                <View style={{margin: 5, marginTop: 0}}>
                  <Text style={{fontSize: 10, textAlign: 'justify'}}>
                    Join an existing effort to knock doors and encourge our neighbors to get out and vote.
                  </Text>
                </View>

                <View style={{margin: 5}}>
                  <Icon.Button
                    name="id-badge"
                    backgroundColor="#d7d7d7"
                    color="#000000"
                    onPress={() => this.setState({askOrgId: true})}
                    {...iconStyles}>
                    Organization ID
                  </Icon.Button>
                </View>

                <View style={{margin: 5, marginTop: 0}}>
                  <Text style={{fontSize: 10, textAlign: 'justify'}}>
                    Didn't receive a QR Code? Enter the Organization ID for your canvassing operation to join.
                  </Text>
                </View>

                <View style={{margin: 5}}>
                  <Icon.Button
                    name="user-circle"
                    backgroundColor="#d7d7d7"
                    color="#000000"
                    onPress={() => navigate('CreateSurvey', {title: 'Solo Project', dbx: null, form: null, refer: this})}
                    {...iconStyles}>
                    Solo Project
                  </Icon.Button>
                </View>

                <View style={{margin: 5, marginTop: 0}}>
                  <Text style={{fontSize: 10, textAlign: 'justify'}}>
                    No login required; use the canvassing tool by yourself for a solo project. Uses your device for data storage.
                  </Text>
                </View>

                <View style={{margin: 5}}>
                  <Icon.Button
                    name="dropbox"
                    backgroundColor="#d7d7d7"
                    color="#000000"
                    onPress={() => {
                      if (user.dropbox) navigate('CreateSurvey', {title: 'Dropbox Project', dbx: dbx, form: null, refer: this})
                      else this.openURL(wsbase+'/auth/dm');
                    }}
                    {...iconStyles}>
                    Collaborate with Dropbox
                  </Icon.Button>
                </View>

                <View style={{margin: 5, marginTop: 0}}>
                  <Text style={{fontSize: 10, textAlign: 'justify'}}>
                    Login with a Dropbox account and share data with a small team. Uses Dropbox for data sharing & storage.
                  </Text>
                </View>

                {__DEV__&&DeviceInfo.isEmulator()?
                <View>
                  <View style={{margin: 5}}>
                    <Icon.Button
                      name="code"
                      backgroundColor="#d7d7d7"
                      color="#000000"
                      onPress={() => this.connectToServer((Platform.OS === 'ios'?'localhost':'10.0.2.2')+':8080')}
                      {...iconStyles}>
                      Local Dev
                    </Icon.Button>
                  </View>

                  <View style={{margin: 5, marginTop: 0}}>
                    <Text style={{fontSize: 10, textAlign: 'justify'}}>
                      Connect to your local development instance of HelloVoterHQ
                    </Text>
                  </View>
                </View>
                :
                <View>
                </View>
                }

              </View>

            </View>
          </View>
        </Modal>

        <Modal
          open={this.state.SmLoginScreen}
          modalStyle={{flex: 1, backgroundColor: "transparent",
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}}
          style={{alignItems: 'center'}}
          offset={0}
          overlayBackground={'rgba(0, 0, 0, 0.75)'}
          animationDuration={200}
          animationTension={40}
          modalDidOpen={() => undefined}
          modalDidClose={() => this.setState({SmLoginScreen: false})}
          closeOnTouchOutside={true}
          disableOnBackPress={false}>
          <SmLoginPage refer={this} />
        </Modal>

        <Prompt
          autoCorrect={false}
          autoCapitalize={"characters"}
          visible={this.state.askOrgId}
          title={"Organization ID"}
          belowInputRender={() => (<Text style={{marginBottom: 10}}>If you don’t have a QR Code or Organization ID yet, please ask your organization to provide you with one.</Text>)}
          placeholder="Enter Org ID. Example: NCC1701"
          submitText={"Let's do this!"}
          onCancel={() => this.setState({askOrgId: false})}
          onSubmit={text => this.setState({orgId: text, askOrgId: false}, () => this.connectToGOTV())}
        />

      </ScrollView>
    );
  }

}

const iconStyles = {
  borderRadius: 10,
  paddingLeft: 25,
  padding: 10,
};

const styles = StyleSheet.create({
  header: {
    fontSize: 16,
    textAlign: 'center',
    margin: 10,
  },
  text: {
    textAlign: 'center',
  },
  buttons: {
    justifyContent: 'space-between',
    flexDirection: 'row',
    margin: 20,
    marginBottom: 30,
  },
});