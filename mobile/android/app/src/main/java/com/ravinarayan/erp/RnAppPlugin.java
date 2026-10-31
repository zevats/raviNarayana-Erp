package com.ravinarayan.erp;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

/**
 * Small bridge used by the web app:
 *  - setBrand({ brand }): remembers the edition (standard | delivery) for the next launch's splash;
 *  - pushReady(): whether this build has a Firebase configuration, so the web app only registers
 *    for delivery alerts when it can actually receive them.
 */
@CapacitorPlugin(name = "RnApp")
public class RnAppPlugin extends Plugin {

    @PluginMethod
    public void setBrand(PluginCall call) {
        String brand = "delivery".equals(call.getString("brand", "standard")) ? "delivery" : "standard";
        getContext().getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE).edit().putString("brand", brand).apply();
        call.resolve();
    }

    @PluginMethod
    public void pushReady(PluginCall call) {
        boolean ready = false;
        try {
            // FirebaseApp comes with the push plugin; reflection keeps this build-independent.
            Class<?> firebase = Class.forName("com.google.firebase.FirebaseApp");
            List<?> apps = (List<?>) firebase.getMethod("getApps", Context.class).invoke(null, getContext());
            ready = apps != null && !apps.isEmpty();
        } catch (Throwable ignored) {
            ready = false;
        }
        JSObject result = new JSObject();
        result.put("ready", ready);
        call.resolve(result);
    }
}
