// Floating label headings for the contact form
$(function() {
    $("body").on("input propertychange", ".floating-label-form-group", function(e) {
        $(this).toggleClass("floating-label-form-group-with-value", !!$(e.target).val());
    }).on("focus", ".floating-label-form-group", function() {
        $(this).addClass("floating-label-form-group-with-focus");
    }).on("blur", ".floating-label-form-group", function() {
        $(this).removeClass("floating-label-form-group-with-focus");
    });
});

var currentPage = 'home';

function introAnimation () {
    var initialDelay = 600;
    var headerDelay = 800;

    $('#intro-header-main').delay(initialDelay).fadeIn();
    $('.home-header').delay(headerDelay + initialDelay).fadeIn();
    $('.navbar-custom').delay(2 * headerDelay + initialDelay).fadeIn();
    $('footer').delay(2 * headerDelay  + initialDelay).fadeIn();
}

var menuClicked = false;

$(document).ready(function() {
    var pages = ['home', 'about', 'resume', 'contact'];

    var movementStrength = 10;
    var height = movementStrength / $(document).height();
    var width = movementStrength / $(document).width();

    introAnimation();

    $('#menu-button').mouseup(function(e) {
        menuClicked = true;
    })

    pages.map(function(item, index) {
        $('.' + item + '-button').css("cursor", "pointer")
        $('.' + item + '-button').mouseup(function(e) {

            if (currentPage !== item) {
                $('.' + currentPage + '-content').css('display', 'none');
                $('.' + item + '-content').fadeIn(600);

                $('.' + currentPage + '-header').css('display', 'none');
                $('.' + item + '-header').fadeIn(600);

                $('#intro-header-main').css('background-image', "url('img/"+item+"-bg.jpg')");

                if (item === 'home' || item === 'contact') {
                    $('#intro-header-main').css("height", '85%');
                }
                else {
                    $('#intro-header-main').css("height", '55%');
                }
                currentPage = item;
            }
            if (menuClicked)
                $('#bs-example-navbar-collapse-1').collapse("toggle");

            menuClicked = false;
        })
    });

    $(document).mousemove(function(e){

      var pageX = e.pageX - ($(document).width() / 2);
      var pageY = e.pageY - ($(document).height() / 2);
      var newvalueX = width * pageX * -1;
      var newvalueY = height * pageY * -1;
      $(".intro-header").css("background-position", newvalueX + "px " + newvalueY + "px");
    });
});

// Navigation Scripts to Show Header on Scroll-Up
jQuery(document).ready(function($) {
    var MQL = 1170;

    //primary navigation slide-in effect
    if ($(window).width() > MQL) {
        var headerHeight = $('.navbar-custom').height();
        $(window).on('scroll', {
                previousTop: 0
            },
            function() {
                var currentTop = $(window).scrollTop();
                //check if user is scrolling up
                if (currentTop < this.previousTop) {
                    //if scrolling up...
                    if (currentTop > 0 && $('.navbar-custom').hasClass('is-fixed')) {
                        $('.navbar-custom').addClass('is-visible');
                    } else {
                        $('.navbar-custom').removeClass('is-visible is-fixed');
                    }
                } else if (currentTop > this.previousTop) {
                    //if scrolling down...
                    $('.navbar-custom').removeClass('is-visible');
                    if (currentTop > headerHeight && !$('.navbar-custom').hasClass('is-fixed')) $('.navbar-custom').addClass('is-fixed');
                }
                this.previousTop = currentTop;
            });
    }
});

function preloader() {
    if (document.images) {

        var pages = ['about', 'resume', 'contact', 'home'];
        var images = new Array();
        pages.map(function(item, i) {
            images[i] = new Image();
            images[i].src = "img/"+item+"-bg.jpg";
        })
    }
}

function addLoadEvent(func) {
    var oldonload = window.onload;
    if (typeof window.onload != 'function') {
        window.onload = func;
    } else {
        window.onload = function() {
            if (oldonload) {
                oldonload();
            }
            func();
        }
    }
}

addLoadEvent(preloader);

